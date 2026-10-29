#!/usr/bin/env bash
# 在云服务器上安装/更新 ProfitOS（systemd，不用 Docker）。需要 root，Node.js >= 22.13。
# 用法：在仓库的 profitos/ 目录里  sudo ./deploy/install.sh
set -Eeuo pipefail

src_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
app_dir=/opt/profitos
env_dir=/etc/profitos
data_dir=/var/lib/profitos
backup_dir=/var/backups/profitos

[[ "${EUID:-$(id -u)}" -eq 0 ]] || { echo '请用 root 运行（sudo）' >&2; exit 1; }
command -v node >/dev/null || { echo '未安装 Node.js' >&2; exit 1; }
command -v npm >/dev/null || { echo '未安装 npm' >&2; exit 1; }
node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=13)?0:1)' \
  || { echo "Node 版本过低（$(node -v)），需要 >= 22.13" >&2; exit 1; }

id profitos >/dev/null 2>&1 || useradd --system --home "$data_dir" --shell /usr/sbin/nologin profitos
install -d -o profitos -g profitos -m 0750 "$data_dir" "$backup_dir"
install -d -m 0755 "$env_dir"

# 更新前先备份数据库（首次安装没有）
if [[ -f "$data_dir/profitos.db" && -d "$app_dir" ]]; then
  (cd "$app_dir" && DB_PATH="$data_dir/profitos.db" node --no-warnings scripts/backup.js "$backup_dir/pre-update-$(date +%Y%m%dT%H%M%S).db") || true
fi

# 同步代码（不动数据和配置），再装依赖
install -d -m 0755 "$app_dir"
tar -C "$src_dir" --exclude=node_modules --exclude=data --exclude=.env --exclude=test -cf - . | tar -C "$app_dir" -xf -
(cd "$app_dir" && npm ci --omit=dev --no-audit --no-fund)
chown -R root:root "$app_dir"

if [[ ! -f "$env_dir/profitos.env" ]]; then
  install -m 0640 -o root -g profitos "$app_dir/deploy/profitos.env.example" "$env_dir/profitos.env"
  echo "已生成 $env_dir/profitos.env，请编辑后重启：systemctl restart profitos"
fi

install -m 0644 "$app_dir/deploy/profitos.service" /etc/systemd/system/profitos.service

# 每天备份一次，保留 14 份
cat > /etc/cron.daily/profitos-backup <<'CRON'
#!/bin/sh
cd /opt/profitos && DB_PATH=/var/lib/profitos/profitos.db runuser -u profitos -- node --no-warnings scripts/backup.js "/var/backups/profitos/daily-$(date +%F).db" >/dev/null 2>&1
find /var/backups/profitos -name 'daily-*.db' -mtime +14 -delete
CRON
chmod 0755 /etc/cron.daily/profitos-backup

systemctl daemon-reload
systemctl enable profitos >/dev/null
systemctl restart profitos
sleep 2
systemctl is-active --quiet profitos
curl -fsS http://127.0.0.1:3000/healthz && echo
echo 'ProfitOS 已启动（仅监听 127.0.0.1:3000）。'
echo "下一步：把 deploy/Caddyfile.profitos.example 里的站点块加进 /etc/caddy/Caddyfile，然后 systemctl reload caddy"
