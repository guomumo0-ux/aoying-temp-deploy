# ProfitOS · 电商利润工作台（团队云端版）

计算逻辑（和运营口径一致）：

1. **按订单号**把「已售订单」和「已结算订单」匹配。
2. **按 SKU × 购买数量 × 你录入的成本**计算商品成本（SKU 成本优先，其次商品名默认成本）。
3. **利润 = 结算收入 − 商品成本 − 广告成本 − 出库/上架等额外费用**。
   - 平台费用（手续费、佣金、物流…）已含在结算金额里，只展示，不重复扣。
   - 广告成本按实际消耗**全额**扣除，秒拍秒退（结算为 0）的订单产生的消耗也不会漏。
4. **未结算订单单独列出和预估**（订单金额、预估回款、预估毛利），**不计入净利润**，不当作已经赚到的钱。
   预估回款比例 = 已结算订单历史上 结算金额 ÷ 订单金额。
5. 结算金额 ≤ 0 的订单默认不计商品成本（货没发/已退回）；可在「设置」里改。

页面：总览、数据导入、商品成本、商品利润、订单明细、售后分析、广告分析、数据核对、设置（汇率/口径/团队成员）。

## 团队使用

- 第一次打开网页创建管理员账号；管理员在「设置 → 团队成员」添加同事（邮箱 + 初始密码）。
- 成员：导入数据、录入成本和额外费用、查看全部报表。管理员：另可管理成员、改汇率与口径、清空数据。
- 所有人看到的是同一份数据。同一订单重复导入是**覆盖**，不会叠加。

## 数据导入

支持 `.xlsx` / `.csv`（UTF-8 或 GBK）。上传后会按表头自动识别列（中英文都认），你可以在页面里核对/调整；
费用类字段可以「+ 列求和」把多列加在一起（比如多个物流相关列）。文件在浏览器里解析，只把整理后的行传给服务器。

建议顺序：已售订单 → 已结算订单 → 商品成本 → 广告消耗 → 打开「数据核对」处理红色/黄色提示（缺成本的 SKU、没匹配上的结算订单、GMV Max 是否重复扣除）。

## 部署到云服务器（Docker，推荐）

要求：一台能装 Docker 的 Linux 云服务器（1 核 1G 够用），开放 80/443 端口。

```bash
git clone <本仓库> && cd aoying-temp-deploy/profitos
cp .env.example .env      # 填 DOMAIN（域名已解析到服务器）；有域名就把 COOKIE_SECURE 改成 1
docker compose up -d --build
```

- 没有域名：`DOMAIN` 留空，用 `http://服务器IP` 访问（流量未加密，建议尽快绑域名）。
- 数据在 Docker 卷 `profitos-data`（SQLite 文件 `/data/profitos.db`）。
- 更新：`git pull && docker compose up -d --build`，数据不丢。
- 备份（建议加入 crontab）：
  ```bash
  docker compose exec app node scripts/backup.js /data/backup-$(date +%F).db
  ```
  再用 `docker cp` 或挂载目录把备份文件拷走。

### 不用 Docker（systemd，已有 Node 24 + Caddy 的服务器适用）

```bash
git clone -b claude/profitos-workbench https://github.com/guomumo0-ux/aoying-temp-deploy
cd aoying-temp-deploy/profitos
sudo ./deploy/install.sh
sudo nano /etc/profitos/profitos.env     # 填 ADMIN_EMAIL / ADMIN_PASSWORD，保存后：
sudo systemctl restart profitos
```

脚本会：创建 `profitos` 系统用户 → 代码装到 `/opt/profitos` → 数据库在 `/var/lib/profitos/` → 注册 systemd 服务（开机自启、崩溃重启）→ 每天自动备份到 `/var/backups/profitos/`（保留 14 天）。
服务只监听 `127.0.0.1:3000`，对外 HTTPS 由 Caddy 提供：把 `deploy/Caddyfile.profitos.example` 里的站点块（改成你的域名，或 `<公网IP用横线连接>.sslip.io`）追加到 `/etc/caddy/Caddyfile`，再 `sudo systemctl reload caddy`。和已有站点并存，不影响。

更新：`git pull && sudo ./deploy/install.sh`（会先备份数据库，配置和数据不动）。
查看日志：`journalctl -u profitos -f`。

其他平台（Render / Railway / Fly.io）：用本目录的 `Dockerfile`，并**挂载持久化磁盘到 `/data`**，设置 `ADMIN_EMAIL` / `ADMIN_PASSWORD`。

## 本地试用

```bash
npm ci
npm run seed          # 写入演示数据，账号 demo@example.com / demo12345
DB_PATH=data/demo.db npm start   # http://localhost:3000
npm test
```

## 环境变量

| 变量 | 说明 |
| --- | --- |
| `PORT` | 监听端口，默认 3000 |
| `DB_PATH` | SQLite 文件路径，默认 `./data/profitos.db` |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME` | 数据库里还没有用户时自动创建管理员 |
| `COOKIE_SECURE` | `1` = 登录 Cookie 仅 HTTPS 传输 |

## 已知限制

- 单实例 + SQLite，面向十几人以内的小团队；数据量到几十万订单仍然可用。
- 汇率为手动设置（设置页），不自动更新。
- 前端的 Excel 解析库 `xlsx@0.18.5`（SheetJS 社区版）有已公开的漏洞公告，只在浏览器里解析你自己上传的文件，不在服务端运行；请只导入可信来源的文件。
