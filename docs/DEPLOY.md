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
                    │  ├─ /data/    ──► alias       │  /var/lib/pingdou/data
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

**运行时数据分离**：商品数据 / 图片 / 统计库都在 `/var/lib/pingdou/`，由 systemd env 显式指向。
源码、`/var/www/pingdou/`、`/var/lib/pingdou/` 三者互不污染。详见末尾「运行时数据管理」一节。

## 关键决策（排错时先看这里）

| 事项 | 结论 | 原因 |
|---|---|---|
| 前端托管方式 | nginx 直接托管 `dist/` | 省一个 Node 进程；`vite preview` 是预览服务器，不适合生产 |
| 静态文件放在 `/var/www/pingdou` 而**不是** `/root/project/pingdou/dist` | 必须复制出来 | `/root` 权限是 `550`，nginx worker 以 `nginx` 用户运行，**穿不透**，直接 root 到那里会 403 |
| 运行时数据（products / images / stats.db）放在 `/var/lib/pingdou/`，由 env 指向 | 不放源码、不放 deploy 产物 | admin 改了**立刻生效**，且 deploy 脚本不会踩到 |
| 后端 `.env` 的 `PORT` | `3000`，**不能是 80** | 80 被 nginx 占用；后端有端口回退逻辑，会静默跑到 81 且 nginx 反代不到 |
| nginx 配置目录 | `/etc/nginx/conf.d/*.conf` | RHEL 系没有 Debian 的 `sites-available/sites-enabled` |
| certbot 安装方式 | `python3 -m venv /opt/certbot` + pip | alinux4 仓库里没有 certbot，也没有 epel |
| 证书校验方式 | `--webroot`（不是 `--nginx`） | pip 装的 certbot 没带 nginx 插件；且自己写配置比让 certbot 改配置更可控 |
| OCSP stapling | **不开启** | Let's Encrypt 已于 2025 年停止在证书里带 OCSP 地址 |
| nginx 启动方式 | 交给 systemd | 阿里云镜像默认是手动 `nginx` 拉的裸进程，重启后不自启、挂了不拉起 |
| 启动必填 env 校验 | 缺一 fail-fast，不静默 fallback | 配置错误不能被"自动回退"掩盖——具体见「运行时数据管理」 |

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

`/root/project/pingdou/.env` 里的 `PORT` 必须是 `3000`，并且**必填 4 个 env**（详见末尾「运行时数据管理」）。

```bash
cd /root/project/pingdou
cp -a .env .env.bak.$(date +%Y%m%d%H%M%S)
sed -i 's/^PORT=80$/PORT=3000/' .env
grep -E '^(PORT|PRODUCTS_JSON_PATH|PRODUCTS_IMAGES_DIR|STATS_DB_PATH|ROOT_PASSWORD)=' .env
```

### 3. 运行时数据目录（必做）

```bash
mkdir -p /var/lib/pingdou/{data,images,db}
chown -R root:root /var/lib/pingdou
chmod 755 /var/lib/pingdou /var/lib/pingdou/{data,images,db}
chmod -R a+rX /var/lib/pingdou/data /var/lib/pingdou/images
# db 不需要 nginx 读——统计库只给后端用
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

# /etc/pingdou-backend.env —— 必填 env 集中在这里，权限锁死
cat > /etc/pingdou-backend.env <<'EOF'
PRODUCTS_JSON_PATH=/var/lib/pingdou/data/products.json
PRODUCTS_IMAGES_DIR=/var/lib/pingdou/images
STATS_DB_PATH=/var/lib/pingdou/db/stats.db
ROOT_PASSWORD=<一串至少 8 位的随机密码，建议 openssl rand -base64 24>
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

> ⚠️ 首次登入后**立刻在 admin 后台改掉 root 密码**，然后从 `/etc/pingdou-backend.env` 删掉 `ROOT_PASSWORD=...`（重新 `daemon-reload` + `restart`）。`ROOT_PASSWORD` 是种子密码，seed 完成后不再需要。

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
- **运行时数据 location**（必须配，不然 admin 编辑的商品/图片访客看不到）：
  ```nginx
  location /data/     { alias /var/lib/pingdou/data/; }
  location /products/ { alias /var/lib/pingdou/images/; }
  ```
  `alias` 结尾的 `/` 必须有

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
检查运行时目录 + systemd env 必填项 → 重启 `pingdou-backend` →
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
| 后端启动直接 fail，报 `PRODUCTS_JSON_PATH env var is required` 等 | systemd unit 缺必填 env，参考「运行时数据管理」配置 `/etc/pingdou-backend.env` |
| 登录后立刻掉登录态 | 先确认 cookie 有没有到后端：`curl -i -X POST localhost/api/auth/logout \| grep -ci '^set-cookie:'`。nginx 默认会透传，所以更可能是 `secure` 属性（`NODE_ENV=production` 时 cookie 只在 HTTPS 下发）或前端没带 `credentials:'include'` |
| admin 改了商品链接，访客没看到 | 检查 nginx 是否有 `location /data/ { alias /var/lib/pingdou/data/; }`；`cat /var/lib/pingdou/data/products.json` 看是不是真的改了；浏览器可能缓存，强制刷新 |
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
├── data/
│   └── products.json                    ← 商品列表（admin 编辑）
├── images/
│   └── *.jpg, *.png                     ← 商品图片（admin 上传）
└── db/
    └── stats.db                         ← SQLite 统计库（后端写）
```

### 启动必填的 env（缺一不可，少一个启动直接 fail）

| env | 含义 | 路径必须存在 |
|---|---|---|
| `PRODUCTS_JSON_PATH` | 商品数据 JSON 文件 | 父目录 |
| `PRODUCTS_IMAGES_DIR` | 商品图片目录 | 是 |
| `STATS_DB_PATH` | SQLite 统计库 | 父目录 |
| `ROOT_PASSWORD` | **首次启动**用来 seed root 账户的密码 | — |

**校验时机**：进程启动时第一件事。任一缺失或路径不存在，进程抛错退出，不会"静默 fallback"。

**ROOT_PASSWORD 特殊说明**：
- ⚠️ **这是"种子密码"，不是 root 的日常密码**——只在 `users` 表为空时（首次启动）使用，seed 完成后这个 env 不会再被读取
- 后续改 root 密码请走 admin 后台（`/api/admin/users/:id`）或登录后改
- 长度必须 ≥ 8 位
- **不要把同一个密码写在两个环境里**（dev 用了 X 就别让 prod 也用 X）

### 权限模型

| 进程 | 用户 | 需要的权限 |
|---|---|---|
| `pingdou-backend` (systemd) | root（systemd unit 默认） | 写 `/var/lib/pingdou/{data,images,db}` |
| `nginx` (worker) | nginx | **读** `/var/lib/pingdou/{data,images}`（仅 nginx 服务这两类，不写） |

```bash
# 后端以 root 跑（systemd 默认），拥有写权限
chown -R root:root /var/lib/pingdou
chmod 755 /var/lib/pingdou /var/lib/pingdou/{data,images,db}

# nginx worker 需要能读 data/ 和 images/（不写）
chmod -R a+rX /var/lib/pingdou/data /var/lib/pingdou/images
```

> **不要把 `/var/lib/pingdou/db/stats.db` 给 nginx 读**——统计库**只**给后端用，不需要暴露到外网。

### nginx alias 配置

让前端请求 `/data/products.json` 和 `/products/xxx.jpg` 走运行时目录：

```nginx
# /etc/nginx/conf.d/pingdou.conf
server {
    root /var/www/pingdou;

    # ★ 运行时数据：从 /var/lib/pingdou/data/ 服务
    location /data/ {
        alias /var/lib/pingdou/data/;
    }

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
- 不要给 `/data/` 加 `Cache-Control: immutable`——admin 编辑后必须能让浏览器拿到新版本
- `public/static-data/` 下的 `mard.json` 和 `default-product.png` 走 nginx 默认静态服务（`root /var/www/pingdou`），**不需要**额外 alias——`vite build` 会把整个 `public/` 复制到 `dist/static-data/`

### 首次启动验证

```bash
systemctl daemon-reload
systemctl restart pingdou-backend
systemctl status pingdou-backend    # 期望 active (running)
journalctl -u pingdou-backend -n 30 --no-pager
# 期望看到：seeded default admin (root)

# 用 seed 密码登入，验证 admin 后台能进
curl -sk -c /tmp/c.txt -b /tmp/c.txt \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"root\",\"password\":\"$ROOT_PASSWORD\"}" \
  https://xn--muu023g.xyz/api/auth/login
# 期望：返回 role=admin
```

登入后**立刻**在 admin 后台改掉 root 密码（这一步必须做，否则 `ROOT_PASSWORD` 是明文落盘的等效凭据）。

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
| `/var/lib/pingdou/db/stats.db` | 每天 | 增量数据，丢了不可恢复 |
| `/var/lib/pingdou/data/products.json` | 每次修改后 | 不频繁，可手动 |
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
chmod 755 /var/lib/pingdou /var/lib/pingdou/{data,images,db}
chmod -R a+rX /var/lib/pingdou/data /var/lib/pingdou/images

# 4. 写 /etc/pingdou-backend.env（必填 env）
# 注意：ROOT_PASSWORD 在新服务器首次启动时不会被读（users 表非空 → seedDefaultAdminIfEmpty 早返回）
# 5. 启动
systemctl restart pingdou-backend
```

### 常见错误对照表

| 启动报错 | 原因 | 怎么查 |
|---|---|---|
| `PRODUCTS_JSON_PATH env var is required` | 没设这个 env | `cat /etc/pingdou-backend.env` |
| `PRODUCTS_JSON_PATH parent dir missing: /var/lib/pingdou/data` | 父目录不存在 | `ls -ld /var/lib/pingdou/data` |
| `PRODUCTS_IMAGES_DIR not found: /var/lib/pingdou/images` | images 目录不存在 | `ls -ld /var/lib/pingdou/images` |
| `STATS_DB_PATH env var is required` | 同上 | 同上 |
| `STATS_DB_PATH parent dir missing: /var/lib/pingdou/db` | db 目录不存在 | `ls -ld /var/lib/pingdou/db` |
| `products.json is corrupt: ...` | products.json JSON 损坏 | `python3 -m json.tool /var/lib/pingdou/data/products.json` 单独测 |
| `ROOT_PASSWORD env var is required ...` | 首次启动没配这个 env | 在 `/etc/pingdou-backend.env` 里加 |
| `ROOT_PASSWORD must be at least 8 characters` | 密码太短 | 换个 ≥ 8 位的 |

**调试技巧**：先把 `journalctl -u pingdou-backend -n 50` 看一遍，绝大部分启动问题都在这里有明确的错误信息。

### 排错清单（动手前问自己）

1. **admin 改了商品链接，访客没看到？** — 99% 是 `PRODUCTS_JSON_PATH` 还指着源码路径或 deploy 时被覆盖。`cat /var/lib/pingdou/data/products.json` 看是不是真的改了。
2. **访客看到 502？** — 后端没起来。看 `journalctl -u pingdou-backend`。
3. **图片显示不出来？** — 服务端会 fallback 到 `/static-data/default-product.png`（在 `public/` 下）；如果连这个都看不到，说明 nginx 配置里 `/static-data/` 没被服务到。
4. **改完 admin 链接需要重启吗？** — 不需要。后端写完 `products.json` 后，下次 `GET /api/products` 请求就拿到新的了。访客可能因为浏览器缓存看不到，强制刷新或加 `?t=<timestamp>` cache-bust。
5. **nginx 报 403？** — 大概率是 `/var/lib/pingdou/data` 或 `/var/lib/pingdou/images` 的权限没设对，`chmod -R a+rX` 一次。