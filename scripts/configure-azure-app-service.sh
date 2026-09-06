#!/usr/bin/env bash
set -euo pipefail

command -v az >/dev/null || { echo "Azure CLI (az) is required. Run this in Azure Cloud Shell." >&2; exit 1; }

RG="${RG:-calendar-sync}"
APP="${APP:-guymichaely-calendar-sync}"
APP_URL="${CALENDAR_APP_URL:-https://guymichaely.com/calendar/}"
PUBLIC_BASE_URL="${CALENDAR_PUBLIC_BASE_URL:-https://${APP}.azurewebsites.net/}"
DATA_DIR="${CALENDAR_DATA_DIR:-/home/calendar-data}"

az webapp show --resource-group "$RG" --name "$APP" >/dev/null

echo "Switching $RG/$APP from a custom container to the Azure Node 24 LTS runtime."
az webapp config set \
  --resource-group "$RG" \
  --name "$APP" \
  --linux-fx-version "NODE|24-lts" \
  --startup-file "npm start" \
  --always-on true \
  -o none

az webapp config appsettings set \
  --resource-group "$RG" \
  --name "$APP" \
  --settings \
    WEBSITE_NODE_DEFAULT_VERSION="~24" \
    CALENDAR_APP_URL="$APP_URL" \
    CALENDAR_PUBLIC_BASE_URL="$PUBLIC_BASE_URL" \
    CALENDAR_DATA_DIR="$DATA_DIR" \
  -o none

az webapp config set \
  --resource-group "$RG" \
  --name "$APP" \
  --generic-configurations '{"healthCheckPath":"/healthz"}' \
  -o none

cat <<EOF

Azure App Service runtime configured.

Web App:          $RG/$APP
Runtime:          Node 24 LTS
Public backend:   $PUBLIC_BASE_URL
Persistent data:  $DATA_DIR
Health check:     /healthz
Google callback:  ${PUBLIC_BASE_URL%/}/auth/callback/google

Still required before the backend can authenticate users:
  1. Connect this Web App to GuyMichaely/calendar, branch main, in Azure Deployment Center.
  2. Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and ALLOWED_GOOGLE_SUBJECT as App Service environment variables.

The backend filesystem store is single-process. Keep this app on one App Service instance.
EOF
