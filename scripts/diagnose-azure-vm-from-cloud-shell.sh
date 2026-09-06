#!/usr/bin/env bash
set -euo pipefail

command -v az >/dev/null || { echo "Azure CLI (az) is required. Run this in Azure Cloud Shell." >&2; exit 1; }

printf 'Azure account:\n'
az account show --query '{subscription:name,subscriptionId:id,tenantId:tenantId,user:user.name}' -o table

mapfile -t VMS < <(az vm list -d --query "[].join('|',[resourceGroup,name,location,powerState,publicIps,privateIps])" -o tsv)
if [ "${#VMS[@]}" -eq 0 ]; then
  echo "No Azure VMs were found in the current subscription."
  exit 0
fi

printf '\nVMs in current subscription:\n'
for i in "${!VMS[@]}"; do
  IFS='|' read -r rg name location power public private <<< "${VMS[$i]}"
  printf '[%d] %s  rg=%s  %s  public=%s  private=%s  location=%s\n' "$((i+1))" "$name" "$rg" "$power" "${public:-none}" "${private:-none}" "$location"
done

if [ "${#VMS[@]}" -eq 1 ]; then
  choice=1
else
  printf '\nChoose the nginx/calendar VM number: '
  read -r choice
fi

case "$choice" in
  ''|*[!0-9]*) echo "Invalid selection." >&2; exit 2 ;;
esac
if [ "$choice" -lt 1 ] || [ "$choice" -gt "${#VMS[@]}" ]; then
  echo "Invalid selection." >&2
  exit 2
fi

IFS='|' read -r RG VM LOCATION POWER PUBLIC_IP PRIVATE_IP <<< "${VMS[$((choice-1))]}"
ADMIN_USER="$(az vm show -g "$RG" -n "$VM" --query osProfile.adminUsername -o tsv 2>/dev/null || true)"
VM_ID="$(az vm show -g "$RG" -n "$VM" --query id -o tsv)"

printf '\nSelected VM:\n'
printf 'resourceGroup=%s\nvm=%s\nlocation=%s\npowerState=%s\npublicIp=%s\nprivateIp=%s\nadminUsername=%s\nresourceId=%s\n' \
  "$RG" "$VM" "$LOCATION" "$POWER" "${PUBLIC_IP:-none}" "${PRIVATE_IP:-none}" "${ADMIN_USER:-unknown}" "$VM_ID"

if [ -n "${PUBLIC_IP:-}" ] && [ -n "${ADMIN_USER:-}" ]; then
  printf 'Likely SSH command: ssh %s@%s\n' "$ADMIN_USER" "$PUBLIC_IP"
fi

printf '\nRunning compact read-only diagnostic through Azure Run Command...\n'
REMOTE_SCRIPT='set +e
printf "=== identity ===\n"; hostname; id
printf "=== os ===\n"; . /etc/os-release 2>/dev/null; echo "${PRETTY_NAME:-unknown}"
printf "=== listeners ===\n"; ss -lntp 2>/dev/null | sed -n "1,30p"
printf "=== nginx ===\n"; nginx -v 2>&1; systemctl is-active nginx 2>/dev/null; nginx -T 2>&1 | grep -E "^[[:space:]]*(listen|server_name|location|proxy_pass|ssl_certificate)[[:space:]]" | sed -E "s#(ssl_certificate_key[[:space:]]+).*#\\1<redacted>;#" | sed -n "1,80p"
printf "=== runtimes ===\n"; command -v bun && bun --version; command -v docker && docker --version; command -v node && node --version
printf "=== services ===\n"; systemctl list-units --type=service --all --no-pager 2>/dev/null | grep -Ei "calendar|bun|node|nginx|docker" | sed -n "1,40p"
printf "=== calendar processes ===\n"; ps -eo user,pid,etime,cmd | grep -Ei "[c]alendar|[b]un|[n]ode" | sed -E "s/(GOOGLE_CLIENT_SECRET|CLIENT_SECRET)=[^ ]+/\\1=<redacted>/g" | sed -n "1,40p"
printf "=== calendar repo ===\n"; find /opt /srv /var/www /home -maxdepth 5 -type d -name .git 2>/dev/null | while read g; do r=${g%/.git}; u=$(git -C "$r" remote get-url origin 2>/dev/null); case "$u" in *GuyMichaely/calendar*) echo "repo=$r"; echo "revision=$(git -C "$r" rev-parse HEAD 2>/dev/null)"; git -C "$r" status --short --branch 2>/dev/null;; esac; done
printf "=== config presence ===\n"; grep -RIl --exclude-dir=.git -E "^(CALENDAR_APP_URL|CALENDAR_PUBLIC_BASE_URL|CALENDAR_DATA_DIR|GOOGLE_CLIENT_ID|GOOGLE_CLIENT_SECRET|ALLOWED_GOOGLE_SUBJECT|HOST|PORT)=" /etc /opt /srv /var/www /home 2>/dev/null | head -20 | while read f; do echo "file=$f"; awk -F= '\''/^(CALENDAR_APP_URL|CALENDAR_PUBLIC_BASE_URL|CALENDAR_DATA_DIR|HOST|PORT)=/{print $1"="$2} /^(GOOGLE_CLIENT_ID|GOOGLE_CLIENT_SECRET|ALLOWED_GOOGLE_SUBJECT)=/{print $1"=<set>"}'\'' "$f" 2>/dev/null; done
printf "=== health ===\n"; for p in 8787 8080 3000; do c=$(curl -sS --connect-timeout 1 --max-time 2 -o /tmp/h -w "%{http_code}" "http://127.0.0.1:$p/healthz" 2>/dev/null); [ "$c" != 000 ] && echo "127.0.0.1:$p/healthz -> $c $(head -c 100 /tmp/h 2>/dev/null)"; done; rm -f /tmp/h
'

az vm run-command invoke \
  --resource-group "$RG" \
  --name "$VM" \
  --command-id RunShellScript \
  --scripts "$REMOTE_SCRIPT" \
  --query 'value[].message' \
  -o tsv

printf '\nPaste the complete output above into the calendar project chat.\n'
