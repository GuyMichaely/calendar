#!/usr/bin/env bash
set -euo pipefail

command -v az >/dev/null || { echo "Azure CLI (az) is required. Run this in Azure Cloud Shell." >&2; exit 1; }

RG="${RG:-calendar-sync}"
LOCATION="${LOCATION:-eastus}"
VM="${VM:-guymichaely-calendar-vm}"
ADMIN_USER="${ADMIN_USER:-guy}"
IMAGE="${IMAGE:-Canonical:ubuntu-24_04-lts:server:latest}"
DEPLOY_REVISION="${DEPLOY_REVISION:-main}"

if [ -n "${SIZE:-}" ]; then
  SIZE_CANDIDATES=("$SIZE")
  SIZE_WAS_EXPLICIT=1
else
  SIZE_CANDIDATES=(Standard_B1s Standard_B1ms Standard_B2s)
  SIZE_WAS_EXPLICIT=0
fi

SUB_ID="$(az account show --query id -o tsv)"
SUB_SHORT="$(printf '%s' "$SUB_ID" | tr -d '-' | cut -c1-8 | tr '[:upper:]' '[:lower:]')"
DNS_LABEL="${DNS_LABEL:-guy-calendar-${SUB_SHORT}}"

az group create --name "$RG" --location "$LOCATION" -o none

sku_is_unrestricted() {
  local candidate="$1"
  local match

  match="$(
    az vm list-skus \
      --location "$LOCATION" \
      --resource-type virtualMachines \
      --size "$candidate" \
      --all \
      --query "[?name=='${candidate}' && length(restrictions)==\`0\`].name | [0]" \
      -o tsv \
      2>/dev/null || true
  )"

  [ "$match" = "$candidate" ]
}

create_vm_with_size() {
  local candidate="$1"
  local output_file
  output_file="$(mktemp)"

  if az vm create \
    --resource-group "$RG" \
    --name "$VM" \
    --location "$LOCATION" \
    --image "$IMAGE" \
    --size "$candidate" \
    --admin-username "$ADMIN_USER" \
    --generate-ssh-keys \
    --public-ip-sku Standard \
    --public-ip-address-dns-name "$DNS_LABEL" \
    --storage-sku StandardSSD_LRS \
    --os-disk-size-gb 30 \
    -o none >"$output_file" 2>&1; then
    cat "$output_file"
    rm -f "$output_file"
    return 0
  fi

  cat "$output_file" >&2
  if grep -Eq 'SkuNotAvailable|Capacity Restrictions|currently not available' "$output_file"; then
    rm -f "$output_file"
    return 75
  fi

  rm -f "$output_file"
  return 1
}

if az vm show -g "$RG" -n "$VM" >/dev/null 2>&1; then
  SIZE="$(az vm show -g "$RG" -n "$VM" --query hardwareProfile.vmSize -o tsv)"
  echo "Reusing existing VM $RG/$VM using $SIZE."
else
  AVAILABLE_CANDIDATES=()
  for candidate in "${SIZE_CANDIDATES[@]}"; do
    if sku_is_unrestricted "$candidate"; then
      AVAILABLE_CANDIDATES+=("$candidate")
    else
      echo "Skipping $candidate because Azure reports a restriction in $LOCATION."
    fi
  done

  if [ "${#AVAILABLE_CANDIDATES[@]}" -eq 0 ]; then
    if [ "$SIZE_WAS_EXPLICIT" -eq 1 ]; then
      echo "Azure reports that $SIZE is restricted in $LOCATION." >&2
    else
      echo "Azure reports that none of the preferred small B-series sizes are currently usable in $LOCATION." >&2
      echo "Retry with another region, for example LOCATION=eastus2, or set SIZE explicitly." >&2
    fi
    exit 3
  fi

  CREATED=0
  for candidate in "${AVAILABLE_CANDIDATES[@]}"; do
    echo "Creating Ubuntu VM $RG/$VM in $LOCATION using $candidate."
    echo "This creates billable Azure VM, disk, network, and public-IP resources."

    if create_vm_with_size "$candidate"; then
      SIZE="$candidate"
      CREATED=1
      break
    else
      status=$?
    fi

    if [ "$status" -eq 75 ] && [ "$SIZE_WAS_EXPLICIT" -eq 0 ]; then
      echo "$candidate hit a live Azure capacity restriction. Trying the next small size."
      continue
    fi

    exit "$status"
  done

  if [ "$CREATED" -ne 1 ]; then
    echo "Azure had no live capacity for the preferred sizes in $LOCATION." >&2
    echo "Retry with another region, for example LOCATION=eastus2." >&2
    exit 4
  fi
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
