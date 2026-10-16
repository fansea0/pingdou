# CA 证书申请 + nginx 部署（精简版）

> 线上环境：阿里云 `120.26.57.141`，Alibaba Cloud Linux 4（RHEL 系 / dnf），域名 `拼豆.xyz`（punycode `xn--muu023g.xyz`）。
> 详细版见 [`DEPLOY.md`](./DEPLOY.md)，踩坑复盘见 [`tutorial-nginx-https.md`](./tutorial-nginx-https.md)。

## 0. 一句话架构

```
浏览器 ──443──► nginx ──┬── /            → /var/www/pingdou        (静态 dist)
                       ├── /assets/     → 同上，1 年缓存
                       ├── /products/   → /var/lib/pingdou/images  (alias)
                       ├── /media/works/ → /var/lib/pingdou/media/works (正则 alias)
                       └── /api/        → 127.0.0.1:3000           (Express)
                ──80──►  只放行 ACME 校验，其余 301 跳 443
```

三个目录各司其职，别混：`/root/project/pingdou`（源码）、`/var/www/pingdou`（构建产物，nginx 只读）、`/var/lib/pingdou`（运行时数据，后端可写）。
静态文件必须拷到 `/var/www`——`/root` 权限 550，nginx worker 以 `nginx` 用户跑，进不去。

---

## 1. CA 证书申请流程

用 **Let's Encrypt（certbot）**，验证方式选 **HTTP-01 + `--webroot`**：certbot 把验证文件丢进指定目录，CA 从公网 `http://域名/.well-known/acme-challenge/xxx` 读走。

```bash
# ① 装 certbot（alinux 仓库没有，也没有 epel，用 venv）
python3 -m venv /opt/certbot
/opt/certbot/bin/pip install --upgrade pip setuptools wheel
/opt/certbot/bin/pip install certbot
ln -sf /opt/certbot/bin/certbot /usr/local/bin/certbot

# ② 建校验目录 + 先只配 80 端口的 nginx（必须先能访问 ACME 路径！）
mkdir -p /var/www/certbot-webroot

# ③ 探针：先确认公网读得到，再消耗 CA 速率配额
echo ok > /var/www/certbot-webroot/.well-known/acme-challenge/probe
curl http://xn--muu023g.xyz/.well-known/acme-challenge/probe    # 期望输出 ok

# ④ staging 预演（不占生产配额）
certbot certonly --webroot -w /var/www/certbot-webroot \
  -d xn--muu023g.xyz -d www.xn--muu023g.xyz \
  --email 你的邮箱 --agree-tos --non-interactive --dry-run

# ⑤ 正式签发（renew_hook 会写进续期配置，续期后自动 reload nginx）
certbot certonly --webroot -w /var/www/certbot-webroot \
  -d xn--muu023g.xyz -d www.xn--muu023g.xyz \
  --email 你的邮箱 --agree-tos --non-interactive \
  --deploy-hook "systemctl reload nginx"

# ⑥ 立刻验证续期链路（别等 90 天后才发现断）
certbot renew --dry-run
```

### 为什么用 `--webroot` 而不是 `--nginx`

| 方式 | 行为 | 本项目选择理由 |
|---|---|---|
| `--nginx` | certbot **自动改你的配置文件** | pip 装的 certbot 没带 nginx 插件；且线上配置必须自己掌控 |
| `--webroot` | 你留个目录，certbot 只往里写文件 | 配置可预测，出问题时不会面对一份没写过的配置 |

### 自动续期

证书 90 天有效。pip 装的 certbot 不带 systemd 定时器，要手写 `certbot-renew.service` + `.timer`：

```bash
systemctl daemon-reload && systemctl enable --now certbot-renew.timer
systemctl list-timers certbot-renew.timer     # 确认实际周期（文档两处写法不一致，以服务器实际输出为准）
```

> ⚠️ 本项目单次续期成功率约 40%~60%（Let's Encrypt 多视角二次验证在阿里云杭州跨境链路上随机不通）。
> 这是**正常现象**，靠高频定时 + 重试兜底，不需要人工干预。
> 别用 `timeout` 强杀 `certbot renew --dry-run`，会留 `.certbot.lock` 导致后续报 `Another instance of Certbot is already running`。

---

## 2. nginx 部署流程

```bash
# ① 构建
export PATH=$(ls -d /root/.nvm/versions/node/*/bin | sort -V | tail -1):$PATH
cd /root/project/pingdou
npm install
npm run build:server     # -> dist-server/
npm run build            # -> dist/

# ② 发布静态文件到 nginx 的地盘
mkdir -p /var/www/pingdou /var/www/certbot-webroot
cp -a dist/. /var/www/pingdou/
chmod -R a+rX /var/www/pingdou       # a+rX：大写 X 只给目录加执行位

# ③ 运行时目录权限：后端要写，nginx 只要读 images/
mkdir -p /var/lib/pingdou/images
chown -R root:root /var/lib/pingdou
chmod 755 /var/lib/pingdou /var/lib/pingdou/images
chmod -R a+rX /var/lib/pingdou/images

# ④ 后端交给 systemd
cat > /etc/pingdou-backend.env <<'EOF'
PINGDOU_DATA_DIR=/var/lib/pingdou
EOF
chmod 600 /etc/pingdou-backend.env
# ...unit 见 DEPLOY.md 第 5 步...
systemctl daemon-reload && systemctl enable --now pingdou-backend
curl -s localhost:3000/api/health        # {"ok":true,"port":3000}

# ⑤ nginx 接管 + 生效配置
nginx -t && systemctl enable --now nginx && systemctl reload nginx
```

> ⚠️ 阿里云镜像默认 nginx 是手动起的裸进程。要 `nginx -s quit` 停掉再交给 systemd，否则端口冲突、且开机不自启。
> ⚠️ 后端 `.env` 里 `PORT` 必须是 **3000**：写 80 会和 nginx 抢端口，而后端有静默回退逻辑，会悄悄跑到 81，nginx 永远反代不通。

日常重新部署只要一条命令：

```bash
bash /root/project/pingdou/scripts/deploy-server.sh
```

---

## 3. 完整 nginx 配置文件

> 服务器上的权威副本在 `/etc/nginx/conf.d/pingdou.conf`。
> 导出真实文件：`ssh root@120.26.57.141 'cat /etc/nginx/conf.d/pingdou.conf'`
> （RHEL 系用 `conf.d/*.conf`，没有 Debian 的 `sites-available/sites-enabled`。）

```nginx
# /etc/nginx/conf.d/pingdou.conf

# ══════════ 80 端口：只干两件事 ══════════
server {
    listen 80;
    listen [::]:80;
    server_name xn--muu023g.xyz www.xn--muu023g.xyz;

    # ① ACME 校验白名单 —— 必须在跳转规则"之前"且用 ^~
    location ^~ /.well-known/acme-challenge/ {
        root /var/www/certbot-webroot;
        default_type "text/plain";
        allow all;
    }

    # ② 其余一律跳 HTTPS
    #    注意 return 写在 location / 里，不是 server 顶层
    location / {
        return 301 https://$host$request_uri;
    }
}

# ══════════ 443 端口：真正的站点 ══════════
server {
    listen 443 ssl http2;           # nginx < 1.25.1 用这行；≥1.25.1 改用独立的 http2 on;
    listen [::]:443 ssl http2;
    server_name xn--muu023g.xyz www.xn--muu023g.xyz;

    # ── 证书 ──
    ssl_certificate     /etc/letsencrypt/live/xn--muu023g.xyz/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/xn--muu023g.xyz/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_session_cache   shared:SSL:10m;
    ssl_session_timeout 1d;
    # 不开 OCSP stapling：Let's Encrypt 已于 2025 年停止在证书里带 OCSP 地址

    root /var/www/pingdou;
    index index.html;

    # ── 带内容 hash 的产物：永久缓存 ──
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        try_files $uri =404;        # 找不到就 404，别 fallback 到 index.html
    }

    # ── 运行时商品图片 ──
    location /products/ {
        alias /var/lib/pingdou/images/;   # 结尾的 / 必须有
        expires 7d;
        add_header Cache-Control "public";
    }

    # ── API 反代到后端 ──
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;                 # 必须
        proxy_set_header X-Real-IP         $remote_addr;          # 建议
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;   # 必须
        proxy_set_header X-Forwarded-Proto $scheme;               # 建议
        # 下面两行不是必需，是显式声明鉴权关键头（见下方讲解）
        proxy_set_header Cookie           $http_cookie;
        proxy_pass_header  Set-Cookie;
    }

    # ── 其余：静态文件 + SPA 回退 ──
    #    /static-data/mard.json 等 public/ 下的文件也走这里，不需要额外 alias
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

---

## 4. 配置逐段讲解

### 4.1 `listen 80` 块：ACME 白名单必须排在跳转之前

`location / { return 301 ...; }` 会把所有请求都跳到 HTTPS——**包括 ACME 校验请求**。CA 收到 301，跟到 HTTPS 后找不到文件，续期直接失败。

而且这类 bug **不在签发当天暴露**：`certonly` 时 80 还没配跳转，能签下来；三个月后自动续期才炸。所以 `^~` 和位置都必须写对，且签完立刻 `certbot renew --dry-run`。

`^~` 的作用是「最长前缀匹配成功后**停止正则匹配**」——防的是以后有人加了 `location ~ \.php$` 之类把 ACME 路径抢走。

### 4.2 `root` + `try_files`：SPA 回退

React 是前端路由，直接访问 `/statics` 在 nginx 看来是个不存在的文件。`try_files $uri $uri/ /index.html` 的意思是"先找真实文件，都没有就回 index.html 交给前端路由"——三步都必须有。

### 4.3 `location /api/` 反代：哪些头是必须的

| 指令 | 是否必须 | 原因 |
|---|---|---|
| `proxy_set_header Host $host` | **必须** | 不设时 Host 会变成上游地址 `127.0.0.1:3000` |
| `X-Forwarded-For $proxy_add_x_forwarded_for` | **必须** | 后端 `server/index.ts:90` 读它取真实客户端 IP，用于 UV 哈希去重；不设则拿到 127.0.0.1，UV 全算一个人 |
| `X-Real-IP $remote_addr` | 建议 | 调试方便 |
| `X-Forwarded-Proto $scheme` | 建议 | 当前后端**没有**消费它，但换个要区分协议的框架就需要 |
| `Cookie` / `Set-Cookie` | **不是必须** | nginx 默认就双向透传。留着是**显式声明**鉴权关键头，防止以后有人加 `proxy_hide_header` 或 `proxy_cache` 改掉语义 |

> 最后一行是本项目文档里曾经写错的地方：早期注释断言"不加这两行登录态会丢"，后来做了对照实验（另起 8899 端口临时 nginx 实例，唯一变量就是这两行）证明 nginx 默认就透传。注释理由要写对。

### 4.4 `location /products/` 的 `alias`

admin 后台传的商品图存在 `/var/lib/pingdou/images/`，不在 `/var/www/pingdou` 里，所以要单独映射：

```nginx
location /products/ { alias /var/lib/pingdou/images/; }
```

- **结尾的 `/` 必须有**，否则拼出来是 `/var/lib/pingdou/imagesxxx.jpg`
- 目录权限要 `chmod -R a+rX`，nginx worker（非 root）才读得到
- `stats.db` **绝不能**给 nginx 读或暴露，它只归后端用

### 4.5 `location /media/works/` 的正则 alias

作品原图与缩略图（admin 上传，前台作品库展示）走这条：

```nginx
location ~ ^/media/works/[0-9a-f]{16}(-t)?\.(png|webp)$ {
    alias /var/lib/pingdou/media/works/;
}
```

⚠️ 这里是**正则 location**（`~` 前缀），不是前缀 `location`——正则 location
下的 `alias` 必须去掉正则里匹配掉的那段前缀（本例是 `works/`）。写错的症状
是 404，和「alias 末尾漏了斜杠」完全一样，排查时容易往错的方向走。

`/products/` 那条是普通前缀 location，两者写法**不能照抄**。

文件名只允许这 2 种形状（16 位小写 hex + `.png` / `-t.webp`），与后端
`server/index.ts` 里 `/media/works/:filename` 的白名单保持一致。正则同时起到了
「不把 `media/` 下的其它文件暴露出去」的作用。

### 4.6 `/assets/` 为什么能永久缓存

Vite 产物文件名带内容 hash（`index.a1b2c3.js`），内容变了文件名就变，所以可以放心 `expires 1y`。`immutable` 告诉浏览器"别回来问我要不要更新"。没带 hash 的文件（`index.html`）绝不能这么配，否则用户永远拿不到新版本。

`try_files $uri =404` 是为了防止一个不存在的 `/assets/xxx.js` 被 SPA 回退成 index.html 返回 200 ——那会让浏览器报一堆莫名其妙的 JS 语法错误。

---

## 6. 流量来源地统计（可选增强）

后台「谁来看我了」板块的省市归属，**默认不需要任何 nginx 改动**：
后端用 npm 包 `ip2region` 自带的离线库（`node_modules/ip2region/data/ip2region.db`，8.7MB）
在内存里查，**IP 不会出境**，单次查询 ~2µs，`npm install` 即得，无需下载数据文件。

- 省名做了归一化（`广东` → `广东省`、`上海` → `上海市`，`内蒙古`/`广西` 等不乱补后缀）
- 境外 IP 归到 `境外`，内网 / 库未覆盖的归到「未知」桶，不伪装成某个省份
- 老库（功能上线前）的记录没有归属，落到「未知」——后台的覆盖率提示会如实显示

### 6.1 想提高覆盖率：切到 nginx geoip2

离线库更新有滞后，新分配的小段 IP 可能查不到。装了 `ngx_http_geoip2_module`
+ GeoLite2-City.mmdb 后可以让 nginx 直接把归属塞进 header，后端会自动优先采信：

```nginx
# http 块（server 块外）
geoip2 /etc/nginx/GeoLite2-City.mmdb {
    $geoip2_country_code country cn;
    $geoip2_province_name  province zh-CN;   # 中文省名，省掉后端归一化
    $geoip2_city_name     city zh-CN;
}

# server 块内 /api/ 的 location
location /api/ {
    proxy_set_header X-Geo-Province $geoip2_province_name;
    proxy_set_header X-Geo-City    $geoip2_city_name;
    # ...原有的 proxy_pass / Host / X-Forwarded-For 等
}
```

> ⚠️ **必须同时在后端 env 里设 `PINGDOU_TRUST_GEO_HEADER=1`**，否则 header 会被忽略。
> 这是故意的：任何人都能伪造请求 header，不显式开启就等于给了一条灌脏数据的路。

```bash
echo 'PINGDOU_TRUST_GEO_HEADER=1' >> /etc/pingdou-backend.env
systemctl restart pingdou-backend
```

没装 geoip2 时这条链路自动不存在，后端回落离线库，两种状态对代码是透明的。

---

## 7. 排错速查

```bash
# 分层验证：从里到外逐层排除
curl -s  localhost:3000/api/health                                    # 1 后端活着吗
curl -s  -H 'Host: xn--muu023g.xyz' http://127.0.0.1/api/health       # 2 nginx→后端通吗
curl -sk https://xn--muu023g.xyz/                                      # 3 HTTPS 配置对吗
curl -s  https://xn--muu023g.xyz/                                      # 4 证书链可信吗

# 状态
systemctl status nginx pingdou-backend certbot-renew.timer
nginx -t                                  # 改完配置必跑
ss -lntp | grep -E ':80|:443|:3000'       # 端口对吗
certbot certificates                      # 证书还剩多少天
```

| 症状 | 原因 |
|---|---|
| 首页 403 | 静态文件还在 `/root/...`，nginx 穿不透 `/root`（550） |
| `/api/*` 502 | 后端没起来，或 `.env` 里 `PORT` 不是 3000（静默回退到 81 了） |
| 登录后立刻掉登录态 | cookie 的 `secure` 属性（`NODE_ENV=production` 时只在 HTTPS 下发），或前端没带 `credentials:'include'` |
| 商品图片 403 | `chmod -R a+rX /var/lib/pingdou/images` + `alias` 路径和结尾斜杠 |
| 续期 404 / 失败 | 80 端口的 `/.well-known/acme-challenge/` 被 301 吃掉了 |
| 续期 `Timeout during connect` / `DNS SERVFAIL` | 跨境链路问题，正常现象，靠重试兜底 |
| 续期 `Another instance of Certbot` | `/var/log/letsencrypt/.certbot.lock` 残留，删掉即可 |
