#!/usr/bin/env bash
set -euo pipefail

command -v az >/dev/null || { echo "Azure CLI (az) is required. Run this in Azure Cloud Shell." >&2; exit 1; }

RG="${RG:-calendar-sync}"
LOCATION="${LOCATION:-eastus}"
VM="${VM:-guymichaely-calendar-vm}"
SIZE="${SIZE:-Standard_B1s}"
ADMIN_USER="${ADMIN_USER:-guy}"
IMAGE="${IMAGE:-Canonical:ubuntu-24_04-lts:server:latest}"
DEPLOY_REVISION="${DEPLOY_REVISION:-main}"

SUB_ID="$(az account show --query id -o tsv)"
SUB_SHORT="$(printf '%s' "$SUB_ID" | tr -d '-' | cut -c1-8 | tr '[:upper:]' '[:lower:]')"
DNS_LABEL="${DNS_LABEL:-guy-calendar-${SUB_SHORT}}"

az group create --name "$RG" --location "$LOCATION" -o none

if az vm show -g "$RG" -n "$VM" >/dev/null 2>&1; then
  echo "Reusing existing VM $RG/$VM."
else
  echo "Creating Ubuntu VM $RG/$VM using $SIZE."
  echo "This creates billable Azure VM, disk, network, and public-IP resources."
  az vm create \
    --resource-group "$RG" \
    --name "$VM" \
    --location "$LOCATION" \
    --image "$IMAGE" \
    --size "$SIZE" \
    --admin-username "$ADMIN_USER" \
    --generate-ssh-keys \
    --public-ip-sku Standard \
    --public-ip-address-dns-name "$DNS_LABEL" \
    --storage-sku StandardSSD_LRS \
    --os-disk-size-gb 30 \
    -o none
fi

az vm open-port -g "$RG" -n "$VM" --port 80 --priority 1001 -o none
az vm open-port -g "$RG" -n "$VM" --port 443 --priority 1002 -o none

PUBLIC_IP="$(az vm show -d -g "$RG" -n "$VM" --query publicIps -o tsv)"
FQDN="$(az vm show -d -g "$RG" -n "$VM" --query fqdns -o tsv)"

if [ -z "$FQDN" ]; then
  echo "The VM does not have a public DNS name. Expected DNS label $DNS_LABEL." >&2
  exit 2
fi

PROVISION_URL="https://raw.githubusercontent.com/GuyMichaely/calendar/${DEPLOY_REVISION}/scripts/provision-ubuntu-host.sh"
REMOTE_SCRIPT="curl -fsSL '${PROVISION_URL}' -o /tmp/provision-calendar-host.sh && chmod 700 /tmp/provision-calendar-host.sh && CALENDAR_HOST='${FQDN}' DEPLOY_REVISION='${DEPLOY_REVISION}' /tmp/provision-calendar-host.sh"

echo "Provisioning Docker, Caddy, firewall rules, and calendar host files through Azure Run Command..."
az vm run-command invoke \
  --resource-group "$RG" \
  --name "$VM" \
  --command-id RunShellScript \
  --scripts "$REMOTE_SCRIPT" \
  --query 'value[].message' \
  -o tsv

cat <<EOF

Azure VM ready.

VM:                 $RG/$VM
Size:               $SIZE
Public IP:          $PUBLIC_IP
Public hostname:    $FQDN
Backend URL:        https://$FQDN/
Google callback:    https://$FQDN/auth/callback/google
SSH from Cloud Shell:
  ssh ${ADMIN_USER}@${FQDN}

The backend container is intentionally not started until Google OAuth values are added on the host.
EOF
