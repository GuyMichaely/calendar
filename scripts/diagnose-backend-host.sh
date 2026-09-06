#!/usr/bin/env bash
set -u
export LC_ALL=C

section() {
  printf '\n===== %s =====\n' "$1"
}

run() {
  printf '$'
  printf ' %q' "$@"
  printf '\n'
  "$@" 2>&1 || true
}

have() {
  command -v "$1" >/dev/null 2>&1
}

sudo_cmd() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  elif have sudo && sudo -n true 2>/dev/null; then
    sudo -n "$@"
  else
    return 126
  fi
}

sanitize_remote() {
  sed -E 's#(https?://)[^/@]+@#\1REDACTED@#g'
}

section "Host"
run date -Is
run hostname
if have hostnamectl; then run hostnamectl; fi
run uname -a
run id

section "Azure VM metadata"
if have curl; then
  metadata="$(curl -fsS --connect-timeout 1 --max-time 2 -H Metadata:true 'http://169.254.169.254/metadata/instance?api-version=2021-02-01' 2>/dev/null || true)"
  if [ -n "$metadata" ]; then
    if have python3; then
      METADATA_JSON="$metadata" python3 - <<'PY'
import json, os
m = json.loads(os.environ["METADATA_JSON"])
c = m.get("compute", {})
print(f"vm.name={c.get('name', '')}")
print(f"vm.resourceGroup={c.get('resourceGroupName', '')}")
print(f"vm.location={c.get('location', '')}")
print(f"vm.size={c.get('vmSize', '')}")
print(f"vm.osType={c.get('osType', '')}")
for i, iface in enumerate(m.get("network", {}).get("interface", [])):
    ipv4 = iface.get("ipv4", {})
    for j, ip in enumerate(ipv4.get("ipAddress", [])):
        print(f"network.interface[{i}].ipv4[{j}].private={ip.get('privateIpAddress', '')}")
        print(f"network.interface[{i}].ipv4[{j}].public={ip.get('publicIpAddress', '')}")
PY
    else
      echo "Azure metadata is available, but python3 is not installed to summarize it."
    fi
  else
    echo "Azure Instance Metadata Service was not reachable from this host."
  fi
else
  echo "curl is not installed."
fi

section "Network"
if have ip; then
  run ip -brief address
  run ip route
fi
if have ss; then run ss -lntup; fi

section "Firewall"
if have ufw; then
  if ! sudo_cmd ufw status verbose; then echo "ufw exists, but non-interactive sudo access is unavailable."; fi
fi
if have nft; then
  if ! sudo_cmd nft list ruleset 2>/dev/null | sed -n '1,160p'; then true; fi
fi

section "nginx"
if have nginx; then
  run nginx -v
  if have systemctl; then
    run systemctl is-active nginx
    run systemctl is-enabled nginx
  fi
  if nginx_dump="$(sudo_cmd nginx -T 2>&1)"; then
    printf '%s\n' "$nginx_dump" \
      | grep -E '^(# configuration file|[[:space:]]*(listen|server_name|location|proxy_pass|ssl_certificate|ssl_certificate_key|root|return)[[:space:]])' \
      | sed -E 's#(ssl_certificate_key[[:space:]]+).*#\1<path redacted>;#' \
      | sed -n '1,240p'
  else
    echo "Could not read the full nginx configuration without interactive sudo."
    for dir in /etc/nginx/sites-enabled /etc/nginx/conf.d; do
      [ -d "$dir" ] && find "$dir" -maxdepth 1 -type f -o -type l 2>/dev/null | sort
    done
  fi
else
  echo "nginx is not installed or is not on PATH."
fi

section "TLS certificates"
if have certbot; then
  sudo_cmd certbot certificates 2>&1 | sed -E 's#(Private Key Path:).*#\1 <redacted>#' || true
else
  echo "certbot is not installed or is not on PATH."
fi

section "Runtime tools"
for tool in bun node npm git docker podman; do
  if have "$tool"; then
    case "$tool" in
      docker|podman) run "$tool" --version ;;
      *) run "$tool" --version ;;
    esac
  else
    echo "$tool: not found"
  fi
done

section "Processes"
ps -eo user,pid,ppid,etime,cmd \
  | grep -Ei '[b]un|[n]ode|[c]alendar|[d]ocker|[p]odman|[n]ginx' \
  | sed -E 's/(GOOGLE_CLIENT_SECRET|clientSecret|CLIENT_SECRET)=([^[:space:]]+)/\1=<redacted>/g' \
  | sed -n '1,160p' || true

section "Containers"
if have docker; then
  docker ps --format 'docker {{.Names}} | {{.Image}} | {{.Status}} | {{.Ports}}' 2>/dev/null || echo "docker is installed, but this user cannot inspect containers."
fi
if have podman; then
  podman ps --format 'podman {{.Names}} | {{.Image}} | {{.Status}} | {{.Ports}}' 2>/dev/null || true
fi

section "Candidate systemd services"
if have systemctl; then
  units="$(systemctl list-unit-files --type=service --no-pager 2>/dev/null | awk '{print $1}' | grep -Ei 'calendar|bun|node|docker|podman' || true)"
  if [ -z "$units" ]; then
    echo "No service unit name matched calendar/bun/node/docker/podman."
  else
    printf '%s\n' "$units"
    while IFS= read -r unit; do
      [ -n "$unit" ] || continue
      echo "--- $unit ---"
      systemctl show "$unit" --no-pager \
        -p LoadState -p ActiveState -p SubState -p UnitFileState \
        -p User -p Group -p WorkingDirectory -p ExecStart -p EnvironmentFiles 2>/dev/null \
        | sed -E 's/(GOOGLE_CLIENT_SECRET|clientSecret|CLIENT_SECRET)=([^ ;]+)/\1=<redacted>/g' || true
    done <<< "$units"
  fi
fi

section "Calendar configuration files"
search_roots=()
for root in /etc /opt /srv /var/www "$HOME"; do
  [ -d "$root" ] && search_roots+=("$root")
done

config_files=""
if [ "${#search_roots[@]}" -gt 0 ]; then
  if [ "$(id -u)" -eq 0 ]; then
    config_files="$(grep -RIl --exclude-dir=.git -E '^(CALENDAR_(APP_URL|PUBLIC_BASE_URL|DATA_DIR|OIDC_PROVIDERS_JSON|ALLOWED_IDENTITIES_JSON)|GOOGLE_CLIENT_ID|GOOGLE_CLIENT_SECRET|ALLOWED_GOOGLE_SUBJECT|HOST|PORT)=' "${search_roots[@]}" 2>/dev/null | head -40 || true)"
  elif have sudo && sudo -n true 2>/dev/null; then
    config_files="$(sudo -n grep -RIl --exclude-dir=.git -E '^(CALENDAR_(APP_URL|PUBLIC_BASE_URL|DATA_DIR|OIDC_PROVIDERS_JSON|ALLOWED_IDENTITIES_JSON)|GOOGLE_CLIENT_ID|GOOGLE_CLIENT_SECRET|ALLOWED_GOOGLE_SUBJECT|HOST|PORT)=' "${search_roots[@]}" 2>/dev/null | head -40 || true)"
  else
    config_files="$(grep -RIl --exclude-dir=.git -E '^(CALENDAR_(APP_URL|PUBLIC_BASE_URL|DATA_DIR|OIDC_PROVIDERS_JSON|ALLOWED_IDENTITIES_JSON)|GOOGLE_CLIENT_ID|GOOGLE_CLIENT_SECRET|ALLOWED_GOOGLE_SUBJECT|HOST|PORT)=' "${search_roots[@]}" 2>/dev/null | head -40 || true)"
  fi
fi

if [ -z "$config_files" ]; then
  echo "No readable file containing calendar deployment variables was found in /etc, /opt, /srv, /var/www, or HOME."
else
  while IFS= read -r file; do
    [ -n "$file" ] || continue
    echo "--- $file ---"
    if [ "$(id -u)" -eq 0 ]; then
      reader=(cat "$file")
    elif have sudo && sudo -n test -r "$file" 2>/dev/null; then
      reader=(sudo -n cat "$file")
    else
      reader=(cat "$file")
    fi
    "${reader[@]}" 2>/dev/null \
      | awk -F= '
          /^(CALENDAR_APP_URL|CALENDAR_PUBLIC_BASE_URL|CALENDAR_DATA_DIR|HOST|PORT)=/ {
            key=$1; sub(/^[^=]*=/, ""); print key "=" $0; next
          }
          /^(GOOGLE_CLIENT_ID|GOOGLE_CLIENT_SECRET|ALLOWED_GOOGLE_SUBJECT|CALENDAR_OIDC_PROVIDERS_JSON|CALENDAR_ALLOWED_IDENTITIES_JSON)=/ {
            key=$1; sub(/^[^=]*=/, ""); print key "=" (length($0) ? "<set>" : "<empty>")
          }
        '
  done <<< "$config_files"
fi

section "Calendar repositories"
repo_roots=()
for root in /opt /srv /var/www "$HOME"; do
  [ -d "$root" ] && repo_roots+=("$root")
done
if [ "${#repo_roots[@]}" -gt 0 ]; then
  while IFS= read -r gitdir; do
    [ -n "$gitdir" ] || continue
    repo="${gitdir%/.git}"
    remote="$(git -C "$repo" remote get-url origin 2>/dev/null | sanitize_remote || true)"
    case "$remote" in
      *GuyMichaely/calendar*)
        echo "repo=$repo"
        echo "origin=$remote"
        echo "branch=$(git -C "$repo" branch --show-current 2>/dev/null || true)"
        echo "revision=$(git -C "$repo" rev-parse HEAD 2>/dev/null || true)"
        git -C "$repo" status --short --branch 2>/dev/null || true
        ;;
    esac
  done < <(find "${repo_roots[@]}" -maxdepth 5 -type d -name .git 2>/dev/null | sort -u)
fi

section "Persistent calendar data"
data_dirs=""
if [ -n "$config_files" ]; then
  while IFS= read -r file; do
    [ -n "$file" ] || continue
    if [ "$(id -u)" -eq 0 ]; then
      lines="$(cat "$file" 2>/dev/null || true)"
    elif have sudo && sudo -n test -r "$file" 2>/dev/null; then
      lines="$(sudo -n cat "$file" 2>/dev/null || true)"
    else
      lines="$(cat "$file" 2>/dev/null || true)"
    fi
    while IFS= read -r value; do
      value="${value#CALENDAR_DATA_DIR=}"
      value="${value%\"}"; value="${value#\"}"
      value="${value%\'}"; value="${value#\'}"
      [ -n "$value" ] && data_dirs="${data_dirs}${value}"$'\n'
    done < <(printf '%s\n' "$lines" | grep '^CALENDAR_DATA_DIR=' || true)
  done <<< "$config_files"
fi

if [ -z "$data_dirs" ]; then
  echo "No CALENDAR_DATA_DIR value was discovered."
else
  printf '%s' "$data_dirs" | sort -u | while IFS= read -r dir; do
    [ -n "$dir" ] || continue
    echo "data_dir=$dir"
    if sudo_cmd test -d "$dir" 2>/dev/null || [ -d "$dir" ]; then
      sudo_cmd find "$dir" -maxdepth 2 -type f -printf '%P\t%s bytes\n' 2>/dev/null | sed -n '1,120p' || true
      sudo_cmd du -sh "$dir" 2>/dev/null || du -sh "$dir" 2>/dev/null || true
    else
      echo "status=missing-or-not-readable"
    fi
  done
fi

section "Local health probes"
if have curl; then
  for port in 8787 8080 3000; do
    code="$(curl -sS --connect-timeout 1 --max-time 2 -o /tmp/calendar-health.$$ -w '%{http_code}' "http://127.0.0.1:${port}/healthz" 2>/dev/null || true)"
    if [ -n "$code" ] && [ "$code" != "000" ]; then
      body="$(head -c 200 /tmp/calendar-health.$$ 2>/dev/null || true)"
      echo "http://127.0.0.1:${port}/healthz -> $code ${body}"
    fi
  done
  rm -f /tmp/calendar-health.$$
  for scheme in http https; do
    args=(-sS --connect-timeout 1 --max-time 3 -o /tmp/calendar-proxy-health.$$ -w '%{http_code}')
    [ "$scheme" = https ] && args+=(-k)
    code="$(curl "${args[@]}" "${scheme}://127.0.0.1/healthz" 2>/dev/null || true)"
    if [ -n "$code" ] && [ "$code" != "000" ]; then
      body="$(head -c 200 /tmp/calendar-proxy-health.$$ 2>/dev/null || true)"
      echo "${scheme}://127.0.0.1/healthz -> $code ${body}"
    fi
  done
  rm -f /tmp/calendar-proxy-health.$$
fi

section "Summary markers"
echo "This script is read-only except for temporary files under /tmp used by curl probes."
echo "It intentionally redacts OAuth secrets and private-key paths."
echo "Paste the complete output back into the calendar project chat."
