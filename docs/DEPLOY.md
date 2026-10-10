# 部署文档（nginx + Let's Encrypt HTTPS）

> 线上环境：阿里云服务器 `120.26.57.141`，系统 Alibaba Cloud Linux 4（RHEL 系 / dnf）。
> 域名 `拼豆.xyz`（punycode `xn--muu023g.xyz`），站点目录 `/root/project/pingdou`。

## 架构

```
                    ┌──────────────────────────────┐
 浏览器 ──443──►   │ nginx (systemd: nginx)       │
                    │  ├─ /             静态文件    │  root /var/www/pingdou
                    │  ├─ /assets/      长缓存 1y   │
                    │  ├─ /static-data/ 前端静态数据│  mard.json / 默认图
                    │  ├─ /products/──► alias       │  /var/lib/pingdou/images
                    │  └─ /api/    ──► 127.0.0.1:3000│  Express
                    └──────────────────────────────┘
                                   ▲
       :80 只留 ACME 校验，其余 301 跳 443
                                   │
                    systemd: pingdou-backend (node dist-server/server/index.js)
                    systemd: certbot-renew.timer (每天两次自动续期)
```

**端口约定**：前端不再跑 Node 进程（nginx 直接托管静态文件），后端 `3000`，对外只有 `80` / `443`。

**运行时数据分离**：商品（SQLite）/ 图片 / 统计库都在 `/var/lib/pingdou/`，由 `PINGDOU_DATA_DIR` env 指向。
源码、`/var/www/pingdou/`、`/var/lib/pingdou/` 三者互不污染。详见末尾「运行时数据管理」一节。

## 关键决策（排错时先看这里）

| 事项 | 结论 | 原因 |
|---|---|---|
| 前端托管方式 | nginx 直接托管 `dist/` | 省一个 Node 进程；`vite preview` 是预览服务器，不适合生产 |
| 静态文件放在 `/var/www/pingdou` 而**不是** `/root/project/pingdou/dist` | 必须复制出来 | `/root` 权限是 `550`，nginx worker 以 `nginx` 用户运行，**穿不透**，直接 root 到那里会 403 |
| 运行时数据（SQLite / images）放在 `/var/lib/pingdou/`，由 `PINGDOU_DATA_DIR` env 指向 | 不放源码、不放 deploy 产物 | admin 改了**立刻生效**，且 deploy 脚本不会踩到 |
| 后端 `.env` 的 `PORT` | `3000`，**不能是 80** | 80 被 nginx 占用；后端有端口回退逻辑，会静默跑到 81 且 nginx 反代不到 |
| nginx 配置目录 | `/etc/nginx/conf.d/*.conf` | RHEL 系没有 Debian 的 `sites-available/sites-enabled` |
| certbot 安装方式 | `python3 -m venv /opt/certbot` + pip | alinux4 仓库里没有 certbot，也没有 epel |
| 证书校验方式 | `--webroot`（不是 `--nginx`） | pip 装的 certbot 没带 nginx 插件；且自己写配置比让 certbot 改配置更可控 |
| OCSP stapling | **不开启** | Let's Encrypt 已于 2025 年停止在证书里带 OCSP 地址 |
| nginx 启动方式 | 交给 systemd | 阿里云镜像默认是手动 `nginx` 拉的裸进程，重启后不自启、挂了不拉起 |
| 启动必填 env 校验 | `PINGDOU_DATA_DIR` 默认 `/var/lib/pingdou`，可省略；生产仍建议显式注入 | 默认值保证本地一键启动，生产以 systemd `EnvironmentFile` 为准——具体见「运行时数据管理」 |

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

### 2. 修正 `.env` 端口 + 准备运行时目录

`/root/project/pingdou/.env` 里的 `PORT` 必须是 `3000`，并显式注入 `PINGDOU_DATA_DIR=/var/lib/pingdou`（虽然代码默认就是这个值，但生产建议显式写出来，便于运维一眼看到数据根；详见末尾「运行时数据管理」）。

```bash
cd /root/project/pingdou
cp -a .env .env.bak.$(date +%Y%m%d%H%M%S)
sed -i 's/^PORT=80$/PORT=3000/' .env
grep -E '^(PORT|PINGDOU_DATA_DIR)=' .env
```

### 3. 运行时数据目录权限（必做）

后端启动时若目录不存在会自动 `mkdirSync({ recursive: true })`，
但**权限**不会自动设置成 nginx 可读。手动设一次：

```bash
mkdir -p /var/lib/pingdou/images
chown -R root:root /var/lib/pingdou
chmod 755 /var/lib/pingdou /var/lib/pingdou/images
chmod -R a+rX /var/lib/pingdou/images
# stats.db 不需要 nginx 读——统计库只给后端用
```

### 4. 构建

```bash
export PATH=$(ls -d /root/.nvm/versions/node/*/bin | sort -V | tail -1):$PATH
cd /root/project/pingdou
npm install          # 首次
npm run build:server # -> dist-server/
npm run build        # -> dist/
```

### 5. 发布静态文件 + 后端 systemd

```bash
mkdir -p /var/www/pingdou /var/www/certbot-webroot
cp -a /root/project/pingdou/dist/. /var/www/pingdou/
chmod -R a+rX /var/www/pingdou

# /etc/pingdou-backend.env —— 运行时 env 集中在这里，权限锁死
cat > /etc/pingdou-backend.env <<'EOF'
PINGDOU_DATA_DIR=/var/lib/pingdou
EOF
chmod 600 /etc/pingdou-backend.env

cat > /etc/systemd/system/pingdou-backend.service <<'EOF'
[Unit]
Description=PingDou Backend (Express API)
After=network.target

[Service]
Type=simple
WorkingDirectory=/root/project/pingdou
EnvironmentFile=/etc/pingdou-backend.env
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
journalctl -u pingdou-backend -n 20 --no-pager
# 期望看到：[pingdou-server] seeded default admin (root)
```

> ⚠️ 首次登入后**立刻在 admin 后台改掉 root 密码**（种子密码 `12345678` 是硬编码的——不改等于无密码）。详见后面「首次登录流程」。

### 6. nginx：先只配 80

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
- **运行时数据 location**（必须配，不然 admin 上传的图片访客看不到）：
  ```nginx
  location /products/ { alias /var/lib/pingdou/images/; }
  ```
  `alias` 结尾的 `/` 必须有。**不要**配 `location /data/`（旧版本产物，新版不再使用）。

```bash
nginx -t && systemctl enable --now nginx
```

> ⚠️ 阿里云镜像默认的 nginx 是手动启动的裸进程。要接管给 systemd：
> `nginx -s quit` 停掉旧的，再 `systemctl enable --now nginx`（否则会端口冲突）。

### 7. 签发证书

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

### 8. 补上 443 配置

在 `pingdou.conf` 里加 443 server 块（引用
`/etc/letsencrypt/live/xn--muu023g.xyz/fullchain.pem`），
并把 80 块改成「除 ACME 外一律 301 跳 https」。然后：

```bash
nginx -t && systemctl reload nginx
```

### 9. 自动续期

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
检查运行时目录 + systemd env (`PINGDOU_DATA_DIR`) → 重启 `pingdou-backend` →
`nginx -t && reload` → 健康检查。

> **如果改了 systemd env**（`/etc/pingdou-backend.env`），记得：
> `sudo systemctl daemon-reload && sudo systemctl restart pingdou-backend`。

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
| 后端启动报 `PINGDOU_DATA_DIR env var is required` | systemd unit 缺 PINGDOU_DATA_DIR | 见「运行时数据管理」（旧版本行为；当前版本未设置会 fallback 到 `/var/lib/pingdou`，如看到此报错说明在跑旧代码，先 `npm run build:server`） |
| 登录后立刻掉登录态 | 先确认 cookie 有没有到后端：`curl -i -X POST localhost/api/auth/logout \| grep -ci '^set-cookie:'`。nginx 默认会透传，所以更可能是 `secure` 属性（`NODE_ENV=production` 时 cookie 只在 HTTPS 下发）或前端没带 `credentials:'include'` |
| admin 改了商品，访客没看到 | 商品走 SQLite，不会被 deploy 覆盖；浏览器可能缓存，强制刷新或加 `?t=<timestamp>` |
| 商品图片 403 | `chmod -R a+rX /var/lib/pingdou/images` + nginx `location /products/` 的 `alias` 路径 |
| 续期报 `Another instance of Certbot is already running` | `/var/log/letsencrypt/.certbot.lock` 残留（多半是上次续期被强杀），删掉即可 |
| 续期报 `Timeout during connect` / `DNS SERVFAIL` | 正常现象，见上面「证书续期」一节，靠重试兜底 |
| 续期报 `404` 或不含 ACME 路径 | 检查 80 端口的 `/.well-known/acme-challenge/` 是否被 301 跳转吃掉（要用 `location ^~`） |
| 改了配置不生效 | `nginx -t` 通过了吗；确认改的是 `/etc/nginx/conf.d/pingdou.conf` |

---

## 运行时数据管理

> 把"运行时可变数据"从"源码"和"部署产物"里彻底剥出来。三类资源，三套位置，互不污染。

### 一句话原则

> **源码只放不变的；构建产物是只读的；运行时数据放独立目录、由 env 指向。**

源码改完必须 build + deploy 才会生效；运行时数据改了**立刻生效**，不重启也行（部分数据需要 cache reload）。

### 三类资源对应三套位置

| 类型 | 位置 | 谁写 | 谁读 | 频率 |
|---|---|---|---|---|
| **源码（不变）** | `/root/project/pingdou/` | 开发者 | build / git | 改一次 → build → deploy |
| **构建产物（部署时一次性写）** | `/var/www/pingdou/` | deploy 脚本 | nginx | build 时一次性 cp，运行时 nginx 只读 |
| **运行时数据（高频可变）** | `/var/lib/pingdou/` | 后端 / admin | 后端 + nginx | admin 改 → 立刻生效 |

具体到文件：

```
/root/project/pingdou/                    # 源码 + 构建产物
├── public/static-data/
│   ├── mard.json                        ← 色板（不变，前端 fetch）
│   └── default-product.png              ← 商品默认占位图（不变）
└── dist/                                # vite build 产物（deploy 时复制到 /var/www）

/var/www/pingdou/                        # 部署的静态产物（nginx root）
├── index.html
├── assets/                              ← 带 hash 的 JS / CSS（永久缓存）
└── samples/                             ← SEO 用示例图

/var/lib/pingdou/                        # ★ 运行时数据（重点保护）
├── stats.db                             ← SQLite：商品表 + 用户表 + 事件表（后端写）
└── images/
    └── *.jpg, *.png                     ← 商品图片（admin 上传）
```

### 启动 env（`PINGDOU_DATA_DIR` 默认 `/var/lib/pingdou`，可不设）

| env | 必填 | 默认 | 含义 |
|---|---|---|---|
| `PINGDOU_DATA_DIR` | ❌（生产建议显式） | `/var/lib/pingdou` | 运行时数据根目录，含 `stats.db` 与 `images/` |

**校验时机**：进程启动时第一件事。如果 `PINGDOU_DATA_DIR` 没设，使用默认 `/var/lib/pingdou`（`resolve()` 后再拼 `images/` 和 `stats.db`），不会抛错退出。本地开发 / 临时启动可以直接用默认值；生产建议通过 systemd `EnvironmentFile` 显式注入，便于运维核对。

**默认 seed 账户**：首次启动（`users` 表为空时）后端会自动 seed 一个 `root` 管理员，**种子密码硬编码为 `12345678`**——这不是 env、不能改；登录后强制改密（见下面「首次登录流程」）。

### 权限模型

| 进程 | 用户 | 需要的权限 |
|---|---|---|
| `pingdou-backend` (systemd) | root（systemd unit 默认） | 写 `/var/lib/pingdou`（含 `stats.db` 和 `images/`） |
| `nginx` (worker) | nginx | **读** `/var/lib/pingdou/images`（不写） |

```bash
# 后端以 root 跑（systemd 默认），拥有写权限
chown -R root:root /var/lib/pingdou
chmod 755 /var/lib/pingdou /var/lib/pingdou/images

# nginx worker 需要能读 images/（不写）
chmod -R a+rX /var/lib/pingdou/images
```

> **不要把 `/var/lib/pingdou/stats.db` 给 nginx 读**——统计库**只**给后端用，不需要暴露到外网。

### nginx alias 配置

让前端请求 `/products/xxx.jpg` 走运行时目录：

```nginx
# /etc/nginx/conf.d/pingdou.conf
server {
    root /var/www/pingdou;

    # ★ 商品图片：从 /var/lib/pingdou/images/ 服务
    location /products/ {
        alias /var/lib/pingdou/images/;
    }

    location /assets/ { expires 1y; add_header Cache-Control "public, immutable"; }
    location /api/   { proxy_pass http://127.0.0.1:3000; }
    location / { try_files $uri $uri/ /index.html; }
}
```

**关键细节**：
- `alias` 结尾的 `/` 必须有，否则会拼错路径
- 新版本不再使用 `/data/` alias；删除 nginx conf 中的 `location /data/` 块
- `public/static-data/` 下的 `mard.json` 和 `default-product.png` 走 nginx 默认静态服务（`root /var/www/pingdou`），**不需要**额外 alias——`vite build` 会把整个 `public/` 复制到 `dist/static-data/`

### 首次启动验证

```bash
systemctl daemon-reload
systemctl restart pingdou-backend
systemctl status pingdou-backend    # 期望 active (running)
journalctl -u pingdou-backend -n 30 --no-pager
# 期望看到：seeded default admin (root) — login with username=root, password=12345678

# 用 seed 密码登入，验证 admin 后台能进
curl -sk -c /tmp/c.txt -b /tmp/c.txt \
  -H 'Content-Type: application/json' \
  -d '{"username":"root","password":"12345678"}' \
  https://xn--muu023g.xyz/api/auth/login
# 期望：返回 role=admin（并带 mustChangePassword: true）
```

登入后**立刻**在 `/statics` 后台改掉 root 密码——种子密码 `12345678` 是**硬编码**的（不是 env），所有部署都一样，**不改等于无密码**。详见下面「首次登录流程」。

### 首次登录流程

> **首次登录流程**：
>
> 部署完成后：
>
> 1. 打开 `https://<域名>/statics`
> 2. 用户名 `root`，密码 `12345678`
> 3. 登录后弹出强制改密 modal，输入旧密码 `12345678` + 新密码（≥ 4 位）
> 4. 改密成功后才能进入业务页
>
> **不要**保留默认密码；改密后通过 admin 后台管理其他账号。

### 备份与恢复

#### 备份什么

```bash
# 必备：runtime data 目录
tar czf backup-$(date +%Y%m%d).tar.gz /var/lib/pingdou

# 可选：构建产物（恢复时节省 build 时间）
tar czf dist-$(date +%Y%m%d).tar.gz /var/www/pingdou
```

**不要备份源码目录**——源码在 git 里。

#### 备份频率建议

| 数据 | 频率 | 理由 |
|---|---|---|
| `/var/lib/pingdou/stats.db` | 每天 | 含商品 / 用户 / 事件，丢了不可恢复 |
| `/var/lib/pingdou/images/` | 每次上传后 | 不频繁，可手动 |

最简单：`tar` 整个 `/var/lib/pingdou/` 放进 cron：

```cron
# /etc/cron.d/pingdou-backup
0 3 * * * root tar czf /backup/pingdou-$(date +\%Y\%m\%d).tar.gz /var/lib/pingdou
```

#### 恢复到新服务器

```bash
# 1. 装环境（参考本文件「首次部署步骤」前 4 步）
# 2. 部署代码（npm install && build）
# 3. 恢复数据
tar xzf pingdou-backup.tar.gz -C /
chown -R root:root /var/lib/pingdou
chmod 755 /var/lib/pingdou /var/lib/pingdou/images
chmod -R a+rX /var/lib/pingdou/images

# 4. 写 /etc/pingdou-backend.env（含 PINGDOU_DATA_DIR，未设则代码默认 /var/lib/pingdou）
# 5. 启动
systemctl restart pingdou-backend
```

### 常见错误对照表

| 启动报错 | 原因 | 怎么查 |
|---|---|---|
| `PINGDOU_DATA_DIR env var is required` | 旧版本行为；当前版本未设置会 fallback 到 `/var/lib/pingdou`。如看到这条报错说明在跑旧代码 → 先 `npm run build:server` 后再 deploy | — |
| `PINGDOU_DATA_DIR 路径不存在` | 数据目录没建（注意：当前代码不会检查路径是否存在，只有真正写 stats.db / 写 image 时才会报错） | 跑「运行时数据目录权限」那段的 `mkdir -p` |

**调试技巧**：先把 `journalctl -u pingdou-backend -n 50` 看一遍，绝大部分启动问题都在这里有明确的错误信息。

### 排错清单（动手前问自己）

1. **admin 改了商品，访客没看到？** — 商品走 SQLite (`products` 表)，不会因 deploy 被覆盖；如果是图片，看 `ls /var/lib/pingdou/images/` 有没有，浏览器强制刷新或加 `?t=<timestamp>` cache-bust。
2. **访客看到 502？** — 后端没起来。看 `journalctl -u pingdou-backend`。
3. **图片显示不出来？** — 服务端会 fallback 到 `/static-data/default-product.png`（在 `public/` 下）；如果连这个都看不到，说明 nginx 配置里 `/static-data/` 没被服务到。
4. **改完商品需要重启后端吗？** — 不需要。后端写完 `products` 表后，下次 `GET /api/products` 请求就拿到新的了。访客可能因为浏览器缓存看不到，强制刷新或加 `?t=<timestamp>` cache-bust。
5. **nginx 报 403？** — 大概率是 `/var/lib/pingdou/images` 的权限没设对，`chmod -R a+rX` 一次。