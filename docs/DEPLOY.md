# 部署文档（nginx + Let's Encrypt HTTPS）

> 线上环境：阿里云服务器 `120.26.57.141`，系统 Alibaba Cloud Linux 4（RHEL 系 / dnf）。
> 域名 `拼豆.xyz`（punycode `xn--muu023g.xyz`），站点目录 `/root/project/pingdou`。

## 架构

```
                    ┌──────────────────────────────┐
  浏览器 ──443──►   │ nginx (systemd: nginx)       │
                    │  ├─ /           静态文件      │  root /var/www/pingdou
                    │  ├─ /assets/    长缓存 1y     │
                    │  └─ /api/   ──► 127.0.0.1:3000│  Express
                    └──────────────────────────────┘
                                   ▲
       :80 只留 ACME 校验，其余 301 跳 443
                                   │
                    systemd: pingdou-backend (node dist-server/server/index.js)
                    systemd: certbot-renew.timer (每天两次自动续期)
```

**端口约定**：前端不再跑 Node 进程（nginx 直接托管静态文件），后端 `3000`，对外只有 `80` / `443`。

## 关键决策（排错时先看这里）

| 事项 | 结论 | 原因 |
|---|---|---|
| 前端托管方式 | nginx 直接托管 `dist/` | 省一个 Node 进程；`vite preview` 是预览服务器，不适合生产 |
| 静态文件放在 `/var/www/pingdou` 而**不是** `/root/project/pingdou/dist` | 必须复制出来 | `/root` 权限是 `550`，nginx worker 以 `nginx` 用户运行，**穿不透**，直接 root 到那里会 403 |
| 后端 `.env` 的 `PORT` | `3000`，**不能是 80** | 80 被 nginx 占用；后端有端口回退逻辑，会静默跑到 81 且 nginx 反代不到 |
| nginx 配置目录 | `/etc/nginx/conf.d/*.conf` | RHEL 系没有 Debian 的 `sites-available/sites-enabled` |
| certbot 安装方式 | `python3 -m venv /opt/certbot` + pip | alinux4 仓库里没有 certbot，也没有 epel |
| 证书校验方式 | `--webroot`（不是 `--nginx`） | pip 装的 certbot 没带 nginx 插件；且自己写配置比让 certbot 改配置更可控 |
| OCSP stapling | **不开启** | Let's Encrypt 已于 2025 年停止在证书里带 OCSP 地址 |
| nginx 启动方式 | 交给 systemd | 阿里云镜像默认是手动 `nginx` 拉的裸进程，重启后不自启、挂了不拉起 |

## 首次部署步骤

### 0. 前置检查

```bash
# 域名 A 记录必须已指向服务器
dig +short xn--muu023g.xyz        # 期望 120.26.57.141
# 阿里云安全组需要放行 80 和 443
```

### 1. 安装 certbot

alinux 仓库没有 certbot，用 venv 装：

```bash
python3 -m venv /opt/certbot
/opt/certbot/bin/pip install --upgrade pip setuptools wheel
/opt/certbot/bin/pip install certbot
ln -sf /opt/certbot/bin/certbot /usr/local/bin/certbot
certbot --version
```

### 2. 修正 `.env` 端口

`/root/project/pingdou/.env` 里的 `PORT` 必须是 `3000`：

```bash
cd /root/project/pingdou
cp -a .env .env.bak.$(date +%Y%m%d%H%M%S)
sed -i 's/^PORT=80$/PORT=3000/' .env
grep '^PORT=' .env
```

### 3. 构建

```bash
export PATH=$(ls -d /root/.nvm/versions/node/*/bin | sort -V | tail -1):$PATH
cd /root/project/pingdou
npm install          # 首次
npm run build:server # -> dist-server/
npm run build        # -> dist/
```

### 4. 发布静态文件 + 后端 systemd

```bash
mkdir -p /var/www/pingdou /var/www/certbot-webroot
cp -a /root/project/pingdou/dist/. /var/www/pingdou/
chmod -R a+rX /var/www/pingdou

cat > /etc/systemd/system/pingdou-backend.service <<'EOF'
[Unit]
Description=PingDou Backend (Express API)
After=network.target

[Service]
Type=simple
WorkingDirectory=/root/project/pingdou
# .env 由应用内 dotenv 加载（跟着 WorkingDirectory 走），
# 不用 systemd 的 EnvironmentFile —— 它对含特殊字符的值解析规则太严
ExecStart=/root/.nvm/versions/node/v24.21.0/bin/node /root/project/pingdou/dist-server/server/index.js
Restart=always
RestartSec=5
User=root
StandardOutput=append:/root/project/pingdou/backend.log
StandardError=append:/root/project/pingdou/backend.log

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now pingdou-backend
curl -s localhost:3000/api/health   # {"ok":true,"port":3000}
```

### 5. nginx：先只配 80

配置文件见服务器 `/etc/nginx/conf.d/pingdou.conf`。此阶段要点：

- `location ^~ /.well-known/acme-challenge/` 指向 `/var/www/certbot-webroot`，
  **必须用 `^~`**，否则会被后面的跳转规则吃掉，导致证书续期失败
- `location /api/` 反代到 `127.0.0.1:3000`。
  配置里的 `proxy_set_header Cookie` / `proxy_pass_header Set-Cookie` **不是必需的**——
  实测（端口 8899 起临时 nginx 实例做对照）nginx 默认就双向透传 Cookie 和 Set-Cookie。
  保留它们纯粹是**显式声明鉴权关键头**，防止以后有人加了 `proxy_hide_header` 或 `proxy_cache` 把语义改掉。
  真正必需的是 `Host` / `X-Forwarded-For` / `X-Forwarded-Proto`（nginx 不会替你设成你想要的值）。
  详见 [`tutorial-nginx-https.md`](./tutorial-nginx-https.md) 的"坑 5"。
- `location /` 用 `try_files $uri $uri/ /index.html` 做 SPA 回退

```bash
nginx -t && systemctl enable --now nginx
```

> ⚠️ 阿里云镜像默认的 nginx 是手动启动的裸进程。要接管给 systemd：
> `nginx -s quit` 停掉旧的，再 `systemctl enable --now nginx`（否则会端口冲突）。

### 6. 签发证书

```bash
# 先验证校验路径能从公网读到（这一步最容易翻车）
echo ok > /var/www/certbot-webroot/.well-known/acme-challenge/probe
curl http://xn--muu023g.xyz/.well-known/acme-challenge/probe   # 期望 ok

# staging 预演（不消耗生产速率配额）
certbot certonly --webroot -w /var/www/certbot-webroot \
  -d xn--muu023g.xyz -d www.xn--muu023g.xyz \
  --email 3065941239@qq.com --agree-tos --non-interactive --dry-run

# 正式签发（deploy-hook 会写进 renewal 配置，续期时自动重载 nginx）
certbot certonly --webroot -w /var/www/certbot-webroot \
  -d xn--muu023g.xyz -d www.xn--muu023g.xyz \
  --email 3065941239@qq.com --agree-tos --non-interactive \
  --deploy-hook "systemctl reload nginx"
```

> 用 punycode 形式（`xn--muu023g.xyz`）而不是中文，避免 locale 差异带来的意外。

### 7. 补上 443 配置

在 `pingdou.conf` 里加 443 server 块（引用
`/etc/letsencrypt/live/xn--muu023g.xyz/fullchain.pem`），
并把 80 块改成「除 ACME 外一律 301 跳 https」。然后：

```bash
nginx -t && systemctl reload nginx
```

### 8. 自动续期

pip 装的 certbot **不带** systemd 定时器，需要手写
`/etc/systemd/system/certbot-renew.{service,timer}`（每天两次 + 随机延迟），
然后：

```bash
systemctl daemon-reload
systemctl enable --now certbot-renew.timer
systemctl list-timers certbot-renew.timer
certbot renew --dry-run
```

## 日常重新部署

代码更新后，在服务器上执行：

```bash
bash /root/project/pingdou/scripts/deploy-server.sh
```

脚本会做：构建前后端 → 复制 `dist/` 到 `/var/www/pingdou` →
重启 `pingdou-backend` → `nginx -t && reload` → 健康检查。

## 证书续期（**注意：单次续期是不稳的，靠重试兜底**）

证书 90 天有效。`certbot-renew.timer` 每 6 小时跑一次，剩余 < 30 天时真正发起续期，
续期后按 renewal 配置里的 `renew_hook` 自动 `systemctl reload nginx`。

### 为什么单次续期会随机失败

Let's Encrypt 除了主验证，还会从**多个海外节点做「多视角二次验证」**。
这台服务器在阿里云杭州，跨境链路对这个验证是**随机不通**的，实测两种报错：

| 报错 | 含义 |
|---|---|
| `Timeout during connect` | 海外验证节点连不上 `120.26.57.141:80` |
| `DNS problem: SERVFAIL looking up A` | 万网 NS（`dns9/dns10.hichina.com`）对海外解析器的响应超时 |

实测 DNS 质量：从公共解析器（8.8.8.8 / 1.1.1.1 等）查询虽然最终能解析出
`120.26.57.141`，但**平均耗时 200~600ms，连续查询失败率约 20%**。
这是**万网 NS 的海外可达性问题，不是本机配置问题**，改服务器配置解决不了。

### 应对：高频定时 + 单次多重试

单次成功率大约 40%~60%，但失败是**独立随机**的：

```
每 6 小时 1 次 × 单次最多 3 次重试 = 每天最多 12 次尝试
续期窗口 30 天 → 累计约 360 次尝试
即使单次失败率 60%，360 次全失败的概率 ≈ 0.6^360 ≈ 10^-80
```

**所以自动续期实际是安全的**，不需要人工干预。
（`certbot renew` 在「无需续期」时秒退，跑得勤没有成本。）

### 手工验证

```bash
# 单次失败是正常的，多跑几次看是否至少有一次成功
for i in 1 2 3 4 5; do certbot renew --dry-run && break; echo "第 $i 次失败，重试"; done

# 看实际证书还有多久过期
certbot certificates
```

> ⚠️ `certbot renew --dry-run` **不要加本地 `timeout` 强杀**，
> 否则会在 `/var/log/letsencrypt/` 留下锁文件，导致后续续期报
> `Another instance of Certbot is already running`。
> 真遇到了就删掉 `.certbot.lock` 即可。

### 如果想把根因也治了（可选）

把域名 NS 从万网换成 **Cloudflare**（免费），海外解析会稳定得多，
能消掉 `SERVFAIL` 那一类失败；但 `Timeout during connect` 属于跨境网络问题，
换 DNS 治不了，最终还是靠重试。换 NS 前注意评估对**国内**解析速度的影响。

## 排错速查

```bash
systemctl status pingdou-backend nginx certbot-renew.timer
journalctl -u pingdou-backend -n 50 --no-pager
tail -50 /root/project/pingdou/backend.log
nginx -t
curl -s localhost:3000/api/health          # 后端活着吗
ss -lntp | grep -E ':80|:443|:3000'        # 端口对吗
certbot certificates                       # 证书还有多久过期
openssl s_client -servername xn--muu023g.xyz -connect xn--muu023g.xyz:443 </dev/null 2>/dev/null \
  | openssl x509 -noout -dates
```

| 症状 | 可能原因 |
|---|---|
| 首页 403 | 静态文件放回了 `/root/...`，nginx 穿不透 `/root`（550） |
| `/api/*` 502 | 后端没起来，或 `.env` 里 `PORT` 不是 3000 |
| 登录后立刻掉登录态 | 先确认 cookie 有没有到后端：`curl -i -X POST localhost/api/auth/logout \| grep -ci '^set-cookie:'`。nginx 默认会透传，所以更可能是 `secure` 属性（`NODE_ENV=production` 时 cookie 只在 HTTPS 下发）或前端没带 `credentials:'include'` |
| 续期报 `Another instance of Certbot is already running` | `/var/log/letsencrypt/.certbot.lock` 残留（多半是上次续期被强杀），删掉即可 |
| 续期报 `Timeout during connect` / `DNS SERVFAIL` | 正常现象，见上面「证书续期」一节，靠重试兜底 |
| 续期报 `404` 或不含 ACME 路径 | 检查 80 端口的 `/.well-known/acme-challenge/` 是否被 301 跳转吃掉（要用 `location ^~`） |
| 改了配置不生效 | `nginx -t` 通过了吗；确认改的是 `/etc/nginx/conf.d/pingdou.conf` |
