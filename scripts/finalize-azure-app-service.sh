#!/usr/bin/env bash
set -euo pipefail

RG="${RG:-calendar-sync}"
APP="${APP:-guymichaely-calendar-sync}"
IMAGE_REPO="${IMAGE_REPO:-calendar-backend}"
APP_URL="${APP_URL:-https://guymichaely.com/calendar/}"
PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-https://guymichaely-calendar-sync.azurewebsites.net/}"
DATA_DIR="${DATA_DIR:-/home/calendar-data}"

command -v az >/dev/null || { echo "Azure CLI (az) is required. Run this in Azure Cloud Shell." >&2; exit 1; }

ACR="$(az acr list -g "$RG" --query '[0].name' -o tsv 2>/dev/null || true)"
if [ -z "$ACR" ]; then
  echo "No Azure Container Registry exists in $RG. Run scripts/prepare-azure-app-service.sh first." >&2
  exit 2
fi
LOGIN_SERVER="$(az acr show -g "$RG" -n "$ACR" --query loginServer -o tsv)"
IMAGE="$LOGIN_SERVER/$IMAGE_REPO:latest"

if ! az acr repository show -n "$ACR" --image "$IMAGE_REPO:latest" >/dev/null 2>&1; then
  echo "Image $IMAGE_REPO:latest was not found in $ACR. Run the preparation script first." >&2
  exit 2
fi

GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID:-}"
GOOGLE_CLIENT_SECRET="${GOOGLE_CLIENT_SECRET:-}"
ALLOWED_GOOGLE_SUBJECT="${ALLOWED_GOOGLE_SUBJECT:-}"

if [ -z "$GOOGLE_CLIENT_ID" ]; then
  read -r -p "Google OAuth client ID: " GOOGLE_CLIENT_ID
fi
if [ -z "$GOOGLE_CLIENT_SECRET" ]; then
  read -r -s -p "Google OAuth client secret: " GOOGLE_CLIENT_SECRET
  printf '\n'
fi
if [ -z "$ALLOWED_GOOGLE_SUBJECT" ]; then
  read -r -p "Allowed Google OpenID subject (sub): " ALLOWED_GOOGLE_SUBJECT
fi

for pair in \
  "GOOGLE_CLIENT_ID:$GOOGLE_CLIENT_ID" \
  "GOOGLE_CLIENT_SECRET:$GOOGLE_CLIENT_SECRET" \
  "ALLOWED_GOOGLE_SUBJECT:$ALLOWED_GOOGLE_SUBJECT"; do
  key="${pair%%:*}"
  value="${pair#*:}"
  if [ -z "$value" ]; then
    echo "$key must not be empty." >&2
    exit 2
  fi
done

EXPECTED_REDIRECT="${PUBLIC_BASE_URL%/}/auth/callback/google"
printf '\nAbout to replace the current App Service container with the calendar backend.\n'
printf 'Web App:      %s\n' "$APP"
printf 'Image:        %s\n' "$IMAGE"
printf 'Frontend:     %s\n' "$APP_URL"
printf 'Backend URL:  %s\n' "$PUBLIC_BASE_URL"
printf 'OAuth redirect:%s\n' "$EXPECTED_REDIRECT"
printf 'Data dir:      %s\n\n' "$DATA_DIR"

az webapp config appsettings set \
  -g "$RG" \
  -n "$APP" \
  --settings \
    WEBSITES_PORT=8080 \
    WEBSITES_ENABLE_APP_SERVICE_STORAGE=true \
    HOST=0.0.0.0 \
    PORT=8080 \
    CALENDAR_DATA_DIR="$DATA_DIR" \
    CALENDAR_APP_URL="$APP_URL" \
    CALENDAR_PUBLIC_BASE_URL="$PUBLIC_BASE_URL" \
    GOOGLE_CLIENT_ID="$GOOGLE_CLIENT_ID" \
    GOOGLE_CLIENT_SECRET="$GOOGLE_CLIENT_SECRET" \
    ALLOWED_GOOGLE_SUBJECT="$ALLOWED_GOOGLE_SUBJECT" \
  -o none

az webapp config set \
  -g "$RG" \
  -n "$APP" \
  --generic-configurations '{"acrUseManagedIdentityCreds": true}' \
  -o none

az webapp config container set \
  -g "$RG" \
  -n "$APP" \
  --container-image-name "$IMAGE" \
  --container-registry-url "https://$LOGIN_SERVER" \
  --enable-app-service-storage true \
  -o none

az webapp restart -g "$RG" -n "$APP"

HEALTH_URL="${PUBLIC_BASE_URL%/}/healthz"
echo "Waiting for backend health at $HEALTH_URL ..."
for attempt in $(seq 1 36); do
  if body="$(curl -fsS --connect-timeout 5 --max-time 10 "$HEALTH_URL" 2>/dev/null)"; then
    if [ "$body" = "ok" ]; then
      echo "Backend health check passed."
      echo
      echo "Configure the calendar frontend Remote sync server as:"
      echo "$PUBLIC_BASE_URL"
      echo
      echo "Then use Sign in with Google."
      exit 0
    fi
  fi
  sleep 5
done

echo "Backend did not become healthy. Current App Service container settings:" >&2
az webapp config container show -g "$RG" -n "$APP" -o yaml >&2 || true

echo >&2
echo "Recent App Service logs may explain the startup failure. Try:" >&2
echo "az webapp log tail -g '$RG' -n '$APP'" >&2
exit 1
