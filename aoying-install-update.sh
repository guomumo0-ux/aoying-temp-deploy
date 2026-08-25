#!/usr/bin/env bash
set -Eeuo pipefail
set +x

package='/tmp/aoyinggit/aoying-server-monitor-v1.3.0.tgz'
expected='088b4529a4bbdf5036108ca58216ebd97c4964f4d6f56db2d54cc54b4d424abe'
app_dir='/opt/aoying-monitor'
env_file='/etc/aoying-monitor/aoying-monitor.env'
data_dir='/var/lib/aoying-monitor'
browser_dir='/var/lib/aoying-monitor/ms-playwright'
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_dir="/root/aoying-backups/$stamp"
stage_dir="$(mktemp -d /opt/aoying-stage.XXXXXX)"
switched=0

rollback() {
  status=$?
  trap - ERR
  if (( switched == 1 )); then
    printf '%s\n' 'Update failed after source switch; restoring previous website.' >&2
    systemctl stop aoying-monitor 2>/dev/null || true
    if [[ -d "$app_dir" ]]; then
      mv "$app_dir" "/opt/aoying-monitor.failed-$stamp"
    fi
    if [[ -d "$backup_dir/opt-aoying-monitor-live" ]]; then
      mv "$backup_dir/opt-aoying-monitor-live" "$app_dir"
    fi
    for unit in aoying-monitor.service aoying-collector.service; do
      if [[ -f "$backup_dir/units/$unit" ]]; then
        install -m 0644 "$backup_dir/units/$unit" "/etc/systemd/system/$unit"
      fi
    done
    systemctl daemon-reload || true
    systemctl restart aoying-monitor || true
  fi
  printf 'AOYING_UPDATE_FAILED backup=%s\n' "$backup_dir" >&2
  exit "$status"
}
trap rollback ERR

[[ "${EUID:-$(id -u)}" -eq 0 ]]
[[ -f "$package" ]]
[[ -f "$env_file" ]]
[[ -d "$app_dir" ]]
id aoying-monitor >/dev/null
command -v node >/dev/null
command -v npm >/dev/null
command -v sing-box >/dev/null
command -v caddy >/dev/null
[[ "$(node -p 'process.versions.node.split(".")[0]')" == 24 ]]
[[ "$(sha256sum "$package" | awk '{print $1}')" == "$expected" ]]

install -d -m 0700 "$backup_dir/units"
cp -a "$env_file" "$backup_dir/aoying-monitor.env"
if [[ -d "$data_dir" ]]; then
  cp -a "$data_dir" "$backup_dir/var-lib-aoying-monitor"
fi
for unit_path in /etc/systemd/system/aoying-monitor.service /etc/systemd/system/aoying-collector.service; do
  if [[ -f "$unit_path" ]]; then
    cp -a "$unit_path" "$backup_dir/units/"
  fi
done

tar -xzf "$package" -C "$stage_dir"
cd "$stage_dir"
npm ci --omit=dev
npm test

install -d -o aoying-monitor -g aoying-monitor -m 0755 "$browser_dir"
PLAYWRIGHT_BROWSERS_PATH="$browser_dir" npx playwright install chromium
chown -R aoying-monitor:aoying-monitor "$browser_dir"

if grep -q '^PLAYWRIGHT_BROWSERS_PATH=' "$env_file"; then
  sed -i 's|^PLAYWRIGHT_BROWSERS_PATH=.*$|PLAYWRIGHT_BROWSERS_PATH=/var/lib/aoying-monitor/ms-playwright|' "$env_file"
else
  printf '%s\n' 'PLAYWRIGHT_BROWSERS_PATH=/var/lib/aoying-monitor/ms-playwright' >> "$env_file"
fi
chown aoying-monitor:aoying-monitor "$env_file"
chmod 0600 "$env_file"

systemctl stop aoying-collector 2>/dev/null || true
systemctl stop aoying-monitor
if [[ -d "$data_dir" ]]; then
  cp -a "$data_dir" "$backup_dir/var-lib-aoying-monitor-stopped"
fi

mv "$app_dir" "$backup_dir/opt-aoying-monitor-live"
mv "$stage_dir" "$app_dir"
switched=1

install -m 0644 "$app_dir/deploy/aoying-monitor.service" /etc/systemd/system/aoying-monitor.service
install -m 0644 "$app_dir/deploy/aoying-collector.service" /etc/systemd/system/aoying-collector.service
install -d -m 0755 /etc/systemd/system/sing-box.service.d
install -m 0644 "$app_dir/deploy/sing-box.service.d-aoying.conf" /etc/systemd/system/sing-box.service.d/aoying.conf

systemctl daemon-reload
systemctl restart aoying-monitor
systemctl is-active --quiet aoying-monitor

trap - ERR
printf 'AOYING_CODE_UPDATE_OK backup=%s\n' "$backup_dir"
printf '%s\n' 'NEXT: cd /opt/aoying-monitor && ./deploy/configure-vless.sh'
