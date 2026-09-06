#!/usr/bin/env bash
set -euo pipefail

command -v az >/dev/null || { echo "Azure CLI (az) is required. Run this in Azure Cloud Shell." >&2; exit 1; }

RG="${RG:-calendar-sync}"
APP="${APP:-guymichaely-calendar-sync}"

az webapp show --resource-group "$RG" --name "$APP" >/dev/null

read -r -p "Google OAuth client ID: " GOOGLE_CLIENT_ID
read -r -s -p "Google OAuth client secret: " GOOGLE_CLIENT_SECRET
printf '\n'
read -r -p "Allowed Google OpenID Connect subject (sub): " ALLOWED_GOOGLE_SUBJECT

if [ -z "$GOOGLE_CLIENT_ID" ] || [ -z "$GOOGLE_CLIENT_SECRET" ] || [ -z "$ALLOWED_GOOGLE_SUBJECT" ]; then
  echo "Client ID, client secret, and allowed subject are all required." >&2
  exit 2
fi

az webapp config appsettings set \
  --resource-group "$RG" \
  --name "$APP" \
  --settings \
    GOOGLE_CLIENT_ID="$GOOGLE_CLIENT_ID" \
    GOOGLE_CLIENT_SECRET="$GOOGLE_CLIENT_SECRET" \
    ALLOWED_GOOGLE_SUBJECT="$ALLOWED_GOOGLE_SUBJECT" \
  -o none

unset GOOGLE_CLIENT_SECRET

az webapp restart --resource-group "$RG" --name "$APP" -o none

cat <<EOF

Google authentication settings saved and the Web App restarted.

Callback URI:
  https://${APP}.azurewebsites.net/auth/callback/google

Health endpoint:
  https://${APP}.azurewebsites.net/healthz
EOF
