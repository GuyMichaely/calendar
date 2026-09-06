#!/usr/bin/env bash
set -euo pipefail

RG="${RG:-calendar-sync}"
APP="${APP:-guymichaely-calendar-sync}"
LOCATION="${LOCATION:-eastus}"
IMAGE_REPO="${IMAGE_REPO:-calendar-backend}"
REPO_URL="${REPO_URL:-https://github.com/GuyMichaely/calendar.git}"

command -v az >/dev/null || { echo "Azure CLI (az) is required. Run this in Azure Cloud Shell." >&2; exit 1; }
command -v git >/dev/null || { echo "git is required." >&2; exit 1; }

az webapp show -g "$RG" -n "$APP" >/dev/null

SUB_ID="$(az account show --query id -o tsv)"
SUB_COMPACT="$(printf '%s' "$SUB_ID" | tr -d '-' | tr '[:upper:]' '[:lower:]')"

ACR="$(az acr list -g "$RG" --query '[0].name' -o tsv 2>/dev/null || true)"
if [ -z "$ACR" ]; then
  ACR="guymcalendar${SUB_COMPACT:0:10}"
  availability="$(az acr check-name -n "$ACR" --query nameAvailable -o tsv 2>/dev/null || true)"
  if [ "$availability" != "true" ]; then
    suffix="$(date +%s | tail -c 7)"
    ACR="guymcalendar${SUB_COMPACT:0:6}${suffix}"
  fi
  echo "Creating Azure Container Registry: $ACR"
  az acr create -g "$RG" -n "$ACR" --location "$LOCATION" --sku Basic --admin-enabled false -o none
else
  echo "Reusing Azure Container Registry: $ACR"
fi

az acr config authentication-as-arm update -r "$ACR" --status enabled -o none

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Cloning current main branch..."
git clone --depth 1 --branch main "$REPO_URL" "$TMP/calendar" >/dev/null 2>&1
REV="$(git -C "$TMP/calendar" rev-parse HEAD)"
SHORT_REV="${REV:0:12}"

echo "Building backend image from revision $REV..."
az acr build \
  --registry "$ACR" \
  --image "$IMAGE_REPO:$SHORT_REV" \
  --image "$IMAGE_REPO:latest" \
  --file backend/Dockerfile \
  "$TMP/calendar"

echo "Enabling system-assigned identity on $APP..."
PRINCIPAL_ID="$(az webapp identity assign -g "$RG" -n "$APP" --query principalId -o tsv)"
ACR_ID="$(az acr show -g "$RG" -n "$ACR" --query id -o tsv)"

if ! az role assignment list --assignee-object-id "$PRINCIPAL_ID" --scope "$ACR_ID" --query "[?roleDefinitionName=='AcrPull'] | length(@)" -o tsv 2>/dev/null | grep -qx '[1-9][0-9]*'; then
  echo "Granting AcrPull to the Web App identity..."
  az role assignment create \
    --assignee-object-id "$PRINCIPAL_ID" \
    --assignee-principal-type ServicePrincipal \
    --scope "$ACR_ID" \
    --role AcrPull \
    -o none
else
  echo "AcrPull is already assigned."
fi

az webapp config set \
  -g "$RG" \
  -n "$APP" \
  --generic-configurations '{"acrUseManagedIdentityCreds": true}' \
  -o none

LOGIN_SERVER="$(az acr show -g "$RG" -n "$ACR" --query loginServer -o tsv)"

cat <<EOF

Azure preparation complete.

Web App:       $APP
Resource group:$RG
Registry:      $ACR
Login server:  $LOGIN_SERVER
Image:         $LOGIN_SERVER/$IMAGE_REPO:latest
Built revision:$REV
Identity:      $PRINCIPAL_ID

The Web App is still running its previous container. No calendar runtime settings or OAuth secrets were changed.

Next: create/configure the Google OAuth Web client with this exact redirect URI:
https://$APP.azurewebsites.net/auth/callback/google

Then run scripts/finalize-azure-app-service.sh from the repository, or use the pinned raw script supplied in the calendar project chat.
EOF
