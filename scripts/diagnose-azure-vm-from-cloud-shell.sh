#!/usr/bin/env bash
set -euo pipefail

command -v az >/dev/null || { echo "Azure CLI (az) is required. Run this in Azure Cloud Shell." >&2; exit 1; }

printf 'Azure account:\n'
az account show --query '{subscription:name,subscriptionId:id,tenantId:tenantId,user:user.name}' -o table

printf '\nEnabled subscriptions visible to this account:\n'
az account list --query "[?state=='Enabled'].{subscription:name,id:id,isDefault:isDefault}" -o table

inventory_current_subscription() {
  printf '\n=== Resource groups ===\n'
  az group list --query '[].{name:name,location:location,state:properties.provisioningState}' -o table || true

  printf '\n=== All Azure resources ===\n'
  az resource list --query '[].{name:name,type:type,resourceGroup:resourceGroup,location:location}' -o table || true

  printf '\n=== App Service / Web Apps ===\n'
  az webapp list --query '[].{name:name,resourceGroup:resourceGroup,state:state,kind:kind,host:defaultHostName,httpsOnly:httpsOnly}' -o table 2>/dev/null || true

  mapfile -t WEBAPPS < <(az webapp list --query "[].join('|',[resourceGroup,name])" -o tsv 2>/dev/null || true)
  for row in "${WEBAPPS[@]}"; do
    IFS='|' read -r rg name <<< "$row"
    [ -n "$name" ] || continue
    echo "--- webapp $rg/$name ---"
    az webapp config show -g "$rg" -n "$name" \
      --query '{linuxFxVersion:linuxFxVersion,alwaysOn:alwaysOn,http20Enabled:http20Enabled,ftpsState:ftpsState}' -o yaml 2>/dev/null || true
    az webapp config appsettings list -g "$rg" -n "$name" \
      --query "[?name=='WEBSITES_PORT' || name=='WEBSITES_ENABLE_APP_SERVICE_STORAGE' || starts_with(name,'CALENDAR_') || name=='HOST' || name=='PORT' || name=='GOOGLE_CLIENT_ID' || name=='GOOGLE_CLIENT_SECRET' || name=='ALLOWED_GOOGLE_SUBJECT'].{name:name,value:contains(['GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','ALLOWED_GOOGLE_SUBJECT'],name) && value!='' && '<set>' || value}" \
      -o table 2>/dev/null || true
  done

  printf '\n=== Container Apps ===\n'
  mapfile -t CAPS < <(az resource list --resource-type Microsoft.App/containerApps --query "[].join('|',[resourceGroup,name])" -o tsv 2>/dev/null || true)
  if [ "${#CAPS[@]}" -eq 0 ]; then
    echo "No Container Apps found."
  else
    for row in "${CAPS[@]}"; do
      IFS='|' read -r rg name <<< "$row"
      echo "--- container app $rg/$name ---"
      az resource show -g "$rg" -n "$name" --resource-type Microsoft.App/containerApps \
        --query '{fqdn:properties.configuration.ingress.fqdn,external:properties.configuration.ingress.external,targetPort:properties.configuration.ingress.targetPort,images:properties.template.containers[].image}' \
        -o yaml 2>/dev/null || true
    done
  fi

  printf '\n=== Container Instances ===\n'
  az container list --query '[].{name:name,resourceGroup:resourceGroup,state:instanceView.state,ip:ipAddress.ip,fqdn:ipAddress.fqdn,ports:ipAddress.ports[].port,images:containers[].image}' -o yaml 2>/dev/null || true

  printf '\n=== AKS clusters ===\n'
  az aks list --query '[].{name:name,resourceGroup:resourceGroup,location:location,fqdn:fqdn,kubernetesVersion:kubernetesVersion}' -o table 2>/dev/null || true

  printf '\n=== Public IP addresses ===\n'
  az network public-ip list --query '[].{name:name,resourceGroup:resourceGroup,ip:ipAddress,fqdn:dnsSettings.fqdn,allocation:publicIPAllocationMethod,sku:sku.name}' -o table 2>/dev/null || true

  printf '\n=== DNS zones ===\n'
  az network dns zone list --query '[].{name:name,resourceGroup:resourceGroup,numberOfRecordSets:numberOfRecordSets}' -o table 2>/dev/null || true
}

mapfile -t VMS < <(az vm list -d --query "[].join('|',[resourceGroup,name,location,powerState,publicIps,privateIps])" -o tsv)
if [ "${#VMS[@]}" -eq 0 ]; then
  echo "No Azure VMs were found in the current subscription."
  inventory_current_subscription
  printf '\nPaste the complete output above into the calendar project chat.\n'
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
