# 一次 nginx + Let's Encrypt HTTPS 上线的实战复盘

> 本文不是操作手册（操作手册见 [`DEPLOY.md`](./DEPLOY.md)），而是一份**经验复盘**：
> 记录这次把拼豆项目从「CI 一直失败、服务器上什么都没跑」弄到
> 「https://拼豆.xyz 稳定在线」的完整过程，重点讲**为什么这么做**、**坑背后的原理**、
> 以及**怎么调试**。目标是你下次换台服务器、换个项目时能自己走一遍。

---

## 1. 先勘察，再动手

我做的第一件事不是写配置，而是**把服务器摸清楚**。这一步能省掉后面 80% 的返工。

### 勘察清单

```bash
# 系统与包管理器 —— 决定了后面所有配置文件的写法
cat /etc/os-release          # Alibaba Cloud Linux 4 → RHEL 系，用 dnf
uname -m                     # x86_64

# 运行时在哪 —— 注意：非交互 SSH 的 PATH 常常和你登录时不一样
node -v; npm -v; which node
ls -d /root/.nvm/versions/node/*/bin    # 发现 node 是 nvm 装的，不在系统 PATH 里

# 已经装了什么
nginx -v; certbot --version
ss -lntp | grep -E ':(80|443|3000|5173)'   # 谁在监听什么端口

# 服务怎么起的 —— 这一步最容易被忽略
systemctl list-units | grep -i nginx
ps -eo pid,ppid,user,cmd | grep nginx
```

### 这次勘察救了我三次

| 发现 | 如果不查会怎样 |
|---|---|
| 系统是 **RHEL 系**（alinux4），不是 Debian | 照着网上 Ubuntu 教程写 `/etc/nginx/sites-enabled/`，nginx 根本不会加载这个目录，配置"生效"了但没效果，还找不到原因 |
| node 在 `/root/.nvm/...`，**不在非交互 PATH 里** | systemd 单元里写 `ExecStart=node ...` 会直接启动失败（systemd 不读 `.bashrc`） |
| `/root` 权限是 **550** | nginx 以 `nginx` 用户运行，连 `/root` 目录都进不去，静态文件全部 403 |

### 关键教训

> **勘察的深度决定了返工的次数。**
> 特别是"系统的发行版家族"和"运行时的真实路径"这两项——它们决定了你写的每一行配置能不能用。

---

## 2. 三个架构决策，以及为什么

### 决策一：静态文件让 nginx 直接托管，不要 `vite preview`

**原本的做法**：`vite preview` 跑在 5173，nginx 反代过去。

**问题**：`vite preview` 是**预览服务器**，官方定位就是"构建后本地看看效果"，不是生产服务器。它没有针对静态文件的缓存策略、并发优化，还白白多一个 Node 进程要管。

**改后的做法**：

```nginx
root /var/www/pingdou;
location /assets/ {          # 带内容 hash 的产物，可以永久缓存
    expires 1y;
    add_header Cache-Control "public, immutable";
}
location / { try_files $uri $uri/ /index.html; }   # SPA 回退
```

**通用原则**：**静态资源和应用服务器分开**。nginx 的 `sendfile` 是内核态零拷贝，Node 读文件再吐出来是用户态拷贝，性能差一个量级。能静态化的一律静态化。

### 决策二：后端交给 systemd，不要 `nohup &`

**原本的做法**（旧 CI）：
```bash
nohup npm run start:backend > backend.log 2>&1 &
echo $! > backend.pid
```

**这套写法的三个致命问题**：

1. **挂机不会自愈**——进程崩了就崩了，没人拉起来
2. **重启机器就没了**——开机不自启
3. **pid 文件会撒谎**——进程被 kill 后 pid 文件还在，下次部署读到旧 pid，`kill -0` 检测到进程号被复用还可能误杀别的进程

**systemd 版本**：

```ini
[Service]
Restart=always          # ← 崩了自动重启
RestartSec=5
WorkingDirectory=/root/project/pingdou
ExecStart=/root/.nvm/versions/node/v24.21.0/bin/node /root/project/pingdou/dist-server/server/index.js

[Install]
WantedBy=multi-user.target   # ← 开机自启
```

**通用原则**：**在 Linux 上，任何需要长期运行的进程都应该交给 systemd**（或 supervisor）。自己写 `nohup` + pid 文件重新发明了 systemd，而且做不全。

> 顺带一个细节：`.env` 我没有用 systemd 的 `EnvironmentFile=`，而是让应用内的 `dotenv` 自己读。
> 原因是 systemd 的 `EnvironmentFile` 对含特殊字符的值（比如密码里的 `@`、`$`）解析规则很严，
> 而 dotenv 宽容得多。**配置来源越少越好，能由一个组件负责就别让两个组件都管。**

### 决策三：证书用 `--webroot`，不要 `--nginx`

certbot 有两个插件：

| 方式 | 做法 | 适用场景 |
|---|---|---|
| `--nginx` | certbot 自动**修改**你的 nginx 配置 | 你想让工具托管配置 |
| `--webroot` | 你配置里留个目录，certbot 往里扔验证文件 | 你想自己控制配置 |

**选 `--webroot` 的理由**：

1. 这次 certbot 是 pip 装的，**没带 nginx 插件**（`--nginx` 需要额外装 `certbot-nginx`）
2. 更重要：`--nginx` 会去改你的配置文件。当你想搞清楚"线上配置到底是什么样"时，**让工具悄悄改配置是很糟糕的**——出问题时你会面对一份自己没写过的配置

对应地，配置里要留好这个位置：

```nginx
location ^~ /.well-known/acme-challenge/ {
    root /var/www/certbot-webroot;
    default_type "text/plain";
    allow all;
}
```

**`^~` 这个前缀修饰符必须加**，原因见下一节。

---

## 3. 六个坑，逐个讲透

### 坑 1：`/root` 权限 550，nginx 进不去

**症状**：配置语法检查通过、nginx reload 成功，但访问首页 403。

**原理**：nginx 的 master 进程是 root，但 **worker 进程会降权到 `nginx` 用户**（见 `nginx.conf` 里的 `user nginx;`）。这是刻意的安全设计——worker 是真正处理网络请求的，暴露面最大，必须降权。

而 `/root` 默认权限是 **550**（`dr-xr-x---`），只有 root 和 root 组能进入。所以 nginx worker 连 `cd /root` 都做不到，更别说读文件。

```
dr-xr-x---. 11 root root 4096 /root          ← nginx 用户在这里就被挡住了
drwxr-xr-x   3 root root 4096 /root/project  ← 这两层其实是通的
drwxr-xr-x  15 root root 4096 /root/project/pingdou
```

**处理**：把构建产物发布到 `/var/www/pingdou`，那里是 nginx 的传统地盘。

```bash
cp -a dist/. /var/www/pingdou/
chmod -R a+rX /var/www/pingdou     # a+rX：所有人可读；X 表示只给目录加执行位
```

> `chmod -R a+rX` 里的 **大写 `X`** 是个细节：它只给"目录"加执行位，不给普通文件加。
> 目录需要执行位才能进入，文件不需要。用 `a+rx` 会把所有文件都变成可执行，既不必要也不安全。

**通用原则**：**部署路径要顺着服务用户的权限走，不要跟它对抗。**
网上有一种做法是 `chmod o+x /root`，能跑通，但把 root 家目录对所有人敞开，不值得。

### 坑 2：`.env` 里 `PORT=80`，和后端"抢端口"

**背景**：后端代码是这样的：

```ts
const PORT = Number(process.env.PORT ?? DEFAULT_PORT);
const actual = await findFreePort(requested);   // 从 PORT 开始，往后找 20 个端口
if (actual !== requested) {
  console.warn(`Port ${requested} is busy, falling back to ${actual}`);
}
```

**问题**：服务器 `.env` 里写着 `PORT=80`，而 80 被 nginx 占着。于是后端**不报错**，而是静默地回退到 81 端口跑起来。

**后果特别隐蔽**：进程是活的、`systemctl status` 是绿的、日志里只有一行 warn——但 nginx 把 `/api/` 反代到 3000，永远打不通。

**处理**：改成 `PORT=3000`，改前先备份：

```bash
cp -a .env .env.bak.$(date +%Y%m%d%H%M%S)
sed -i 's/^PORT=80$/PORT=3000/' .env
```

**通用原则**：**"自动回退/自动重试"这类容错逻辑，会把配置错误变成静默错误。**
部署时这类逻辑很坑——你以为它失败了，其实它"成功"了，只是成功在一个你意想不到的地方。
所以部署脚本最后一定要**验证实际监听端口**，而不是只看进程在不在：

```bash
ss -lntp | grep -E ":80 |:443 |:3000"
```

### 坑 3：nginx 在跑，但不受 systemd 管理

**症状**：`systemctl reload nginx` 报 `nginx.service is not active, cannot reload`，但 ps 里明明有 nginx 进程。

**勘察结果**：

```
systemctl status nginx  →  inactive (dead)，unit 是 disabled
ps -eo pid,ppid,user,cmd | grep nginx
  310063  1  root  nginx: master process nginx     ← ppid=1，是个孤儿裸进程
```

**原理**：阿里云的镜像里 nginx 是**手动 `nginx` 启动**的，从没走过 systemd。进程 daemon 化后父进程退出，被 init 收养（ppid=1）。

**处理**（顺序很重要）：

```bash
nginx -s quit                      # 先优雅停掉裸进程，否则 80 端口冲突
sleep 2
systemctl enable --now nginx       # 再由 systemd 接管
```

**通用原则**：**线上进程的"来源"必须清楚。**
"进程在跑"和"服务受管理"是两回事。不受 systemd 管的服务：重启机器就没了、崩了没人管、日志没有统一收集。

> 一个可以复用的判断方法：`ps -eo pid,ppid,cmd | grep <服务名>`。
> 如果 ppid 是 1 而你又不是通过 systemd 起的，多半是个没人管的裸进程。

### 坑 4：ACME 校验路径被 301 跳转吃掉

**背景**：签完证书后，80 端口要改成"除 ACME 外一律跳 HTTPS"：

```nginx
# 80 端口
location ^~ /.well-known/acme-challenge/ {    # ← 必须放在跳转规则之前
    root /var/www/certbot-webroot;
}
location / {
    return 301 https://$host$request_uri;
}
```

**为什么 `^~` 是必须的**：nginx 的 location 匹配规则里

- 普通前缀 `location /` 和 `location /.well-known/.../` 是**最长前缀匹配**（其实不加 `^~` 这里也能正确匹配）
- 但 **`^~` 的作用是"匹配成功后停止正则匹配"**，它是一个**保险**：防止后续有人加了正则 location（比如 `location ~ \.php$`）把 ACME 路径抢走

更重要的实际风险是**顺序和语义**：如果你把 `return 301` 写成 `location / { return 301 ...; }`，而 ACME 的 location 写在它后面——前缀匹配仍然按长度选，ACME 路径会赢。但如果有人图省事直接在 `server` 块顶层写 `return 301`，那**所有请求包括 ACME 都会被跳走**。

**后果**：证书签发当天一切正常，但 **90 天后自动续期会失败**——因为 Let's Encrypt 去 `http://域名/.well-known/acme-challenge/xxx` 取验证文件时收到的是 301，跟到 HTTPS 上又找不到文件。

> ⚠️ 这是最阴险的一类 bug：**它不在部署当天暴露，而在三个月后**。
> 所以签完证书后一定要立刻 `certbot renew --dry-run` 验证续期链路，别等三个月。

**验证方法**（这一步非常值得养成习惯）：

```bash
# 先放个探针文件，确认路径能从公网读到，再去消耗 CA 的速率配额
echo ok > /var/www/certbot-webroot/.well-known/acme-challenge/probe
curl http://你的域名/.well-known/acme-challenge/probe   # 期望输出 ok
```

### 坑 5：Cookie 透传——**一个我差点写进文档的错误结论**

这个项目的鉴权用 cookie（前端 `fetch` 带 `credentials: 'include'`）。直觉上，"反代要透传 cookie"，
所以我一开始在生产配置里写了这两行，并在本文档初稿里断言"**必须**加，否则登录态会丢"：

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Cookie           $http_cookie;   # 请求方向
    proxy_pass_header  Set-Cookie;                    # 响应方向
}
```

**这个断言是错的。我做了对照实验来验证。**

**实验设计**：不去改生产配置（那是拿线上冒险），而是**在端口 8899 起一个独立的临时 nginx 实例**，
反代配置里故意不写任何 Cookie 相关指令，然后跑同一组请求做对照：

```bash
# 临时实例的配置（完整独立，不碰 /etc/nginx/）
cat > /tmp/ngtest.conf <<'EOF'
worker_processes 1;
pid /tmp/ngtest.pid;
events { worker_connections 64; }
http {
    client_body_temp_path /tmp/ngtest-body;
    proxy_temp_path       /tmp/ngtest-proxy;
    server {
        listen 8899;
        location /api/ {
            proxy_pass http://127.0.0.1:3000;
            # 故意什么都不写
        }
    }
}
EOF
nginx -c /tmp/ngtest.conf
```

**实验结果**：

```
【响应方向】Set-Cookie 条数
  生产配置（带 proxy_pass_header） : 2
  临时实例（无任何 Cookie 指令）   : 2      ← 一模一样

【请求方向】带着登录 cookie 访问 /api/auth/me
  临时实例（无 proxy_set_header）  : 200    ← cookie 确实被转发过去了
```

**结论**：**nginx 默认就会双向透传 Cookie 和 Set-Cookie。那两行指令是多余的。**

- 请求方向：nginx 默认转发客户端的所有请求头，`proxy_set_header` 只在你要**改写**某个头时才需要
  （比如 `Host`、`X-Forwarded-For`）
- 响应方向：nginx 默认转发上游的所有响应头，只屏蔽 `Date`、`Server`、`X-Pad`、`X-Accel-*` 这几个，
  `Set-Cookie` **不在屏蔽列表里**

**那还要不要留着？** 生产配置里我保留了它们——不是因为必需，而是**显式声明鉴权关键头**是好的防御，
万一以后有人在别处加了 `proxy_hide_header Set-Cookie` 或启用 `proxy_cache`，这两行能保住语义。
**但注释里的理由必须写对**（"显式声明以防被后续配置遮蔽"），不能写成"不加就会丢登录态"。

**这个坑真正的价值是方法论**：

1. **"众所周知"的配置写法里，有大量是错的或过时的。** 这类"加个指令保险一下"的代码，
   往往是复制传播的结果，没人验证过它到底起不起作用
2. **验证假设要用对照实验，而且要把变量隔离掉。** 我没有去改生产配置做 A/B 测试，
   而是起了个临时实例——**同一个 nginx、同一个后端，唯一变量就是那两行指令**
3. **"加了之后能工作"不等于"因为加了才能工作"。** 这是相关性 vs 因果关系的经典陷阱

> 顺带一提，真正**必须**写、不写就出问题的是这几个头：
> `Host`（默认会变成 `$proxy_host` 即上游地址，需要显式设成 `$host`）、
> `X-Forwarded-For` / `X-Forwarded-Proto`（后端要拿真实客户端 IP 和协议时必须自己加）。

**通用原则**：**任何"状态"跨过代理层时都要验证。** Cookie、`Authorization`、`X-Forwarded-*` 都属于这类。
症状往往是"登录成功但下一秒就掉登录态"，很难从错误信息反推——所以别靠推理，靠实验。

### 坑 6：`STATICS_PASSWORD` 是个废弃变量

**发现的经过**：写验证脚本想用 `.env` 里的密码登录，grep 不到 `STATS_PASSWORD`，查了下发现变量名是 `STATICS_PASSWORD`，再一查代码：

```ts
// server/index.ts:26
if (process.env.STATICS_PASSWORD) {
  console.warn('[pingdou-server] STATICS_PASSWORD env var is ignored (legacy). ...');
}
```

**`STATICS_PASSWORD` 已经废弃了**，登录密码实际存在数据库里（用户表为空时会播种一个默认管理员：`root` / `fansea0117`）。

**教训**：

1. **看代码，别猜**。配置文件里的变量不一定还被使用——废弃变量留在 `.env.example` 里是很常见的债务
2. **默认密码是真实存在的安全风险**。这份默认密码是写死在源码里的，任何看过这个开源仓库的人都知道。**这次验证时用 `root`/`fansea0117` 真的登录成功了**，说明线上就是这个密码。上线后第一件事就该改掉

---

## 4. 调试方法论

这部分是这次最有价值的收获。

### 4.1 分层验证：从里到外，逐层排除

排错时**不要一上来就从公网测**，那样失败了也不知道是哪一层的问题。按这个顺序：

```bash
# 第 1 层：后端本身活着吗？
curl -s localhost:3000/api/health

# 第 2 层：nginx 到后端通吗？（本机打 nginx，用 Host 头模拟域名）
curl -s -H 'Host: xn--muu023g.xyz' http://127.0.0.1/api/health

# 第 3 层：HTTPS 配置对吗？（-k 跳过证书校验）
curl -sk -H 'Host: xn--muu023g.xyz' https://127.0.0.1/

# 第 4 层：证书链本身可信吗？（不加 -k）
curl -s https://xn--muu023g.xyz/

# 第 5 层：从公网真的能访问吗？
curl -s https://xn--muu023g.xyz/api/health
```

**关键技巧：`-H 'Host: 域名' http://127.0.0.1/`**
这样能在服务器上用 `curl` 打本机 nginx，让它走完整的 `server_name` 匹配逻辑，**不依赖 DNS 也不依赖公网**。第 2~4 层的测试全部可以离线做。

### 4.2 分清"我的配置错了"和"外面在抖"

这是这次最有价值的判断。

**现象**：`certbot renew --dry-run` 时好时坏。

**关键判据**：**看报错发生在哪一层。**

```
Timeout during connect (likely firewall problem)     ← LE 的海外节点连不上你的服务器
DNS problem: SERVFAIL looking up A                   ← NS 对海外解析器响应超时
```

这两种都发生在**"Let's Encrypt → 你的域名"这一跳**，而不是"你的 nginx → 文件系统"这一跳。

**怎么确认不是自己的配置问题**：直接测那一跳。

```bash
# 如果这个测试能稳定拿到文件，说明 ACME 路径配置没问题
echo ok > /var/www/certbot-webroot/.well-known/acme-challenge/probe
curl http://域名/.well-known/acme-challenge/probe
```

结果：**能稳定读到 `ok`**。那问题就不在我这边。

**再量化外部环境的稳定性**：

```bash
# 从公共 DNS 反复解析，看看失败率
ok=0; bad=0
for i in $(seq 1 10); do
  dig +time=4 +tries=1 +short @8.8.8.8 你的域名 A | grep -q "你的IP" && ok=$((ok+1)) || bad=$((bad+1))
done
echo "成功 $ok / 失败 $bad"      # 实测：成功 8 / 失败 2
```

**结论**：DNS 解析失败率约 20%、平均耗时 200~600ms。**这是万网 NS 对海外解析器的可达性问题，改服务器配置解决不了。**

> **心法：先确定问题在哪一层，再决定改什么。**
> 如果这次没做这个区分，我会去反复改 nginx 配置——改了也没用，因为根本不是那里错。

### 4.3 小心"假阴性"

**我踩过的一个坑**：有 3 次 `certbot renew --dry-run` 连续失败，我差点得出结论"续期完全不可用"。实际查日志发现：

```
Another instance of Certbot is already running.
```

原因是我之前为了控制时间，用 `timeout 150 certbot renew --dry-run` 强杀了进程，**但 certbot 的锁文件没被清理**，后续所有尝试都被锁挡住了。

**教训**：

1. **别用 `timeout` 强杀有锁机制的程序**，要留清理逻辑，或者用程序自己的超时参数
2. **失败时一定要看失败原因，不能只看"失败"两个字**。三次"失败"可能是三个完全不同的原因
3. 我自己的批量测试脚本把失败原因 grep 出来显示是空的——**"原因为空"本身就是个信号**，说明它不是我预期的那个错误

### 4.4 用概率思维设计重试

确定是"偶发失败"之后，问题就从"怎么修好"变成"**怎么设计重试**"。

**算一下**：

```
单次成功率 p ≈ 0.4~0.6
每次定时执行重试 3 次
每天执行 4 次（每 6 小时）
续期窗口 30 天（证书剩余 < 30 天才发起续期）
─────────────────────────────────
累计尝试次数 ≈ 3 × 4 × 30 = 360 次
整体失败概率 ≈ 0.6^360 ≈ 10^-80
```

**所以自动续期实际是安全的**，不需要人工盯着。

**通用原则**：面对"偶发失败"，先估算单次成功率和可用重试次数，再决定要不要下功夫治根因。
如果重试次数足够多，**把工程精力花在根因上可能是不划算的**——尤其当根因不在你控制范围内时（比如跨境网络）。

### 4.5 频繁 SSH 会触发限流——别误判成密码错误

**症状**：连续执行多条 SSH 命令后，突然开始报

```
Permission denied, please try again.
root@120.26.57.141: Permission denied (publickey,gssapi-keyex,gssapi-with-mic,password)
```

**判断方法**：同时测一下 HTTP 服务。

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://你的域名/     # 200 → 服务器活着
nc -z -w 8 你的IP 22 && echo "22 OPEN"                        # 端口也通
```

**服务器活着 + 端口通 + 密码昨天还能用 → 是防爆破限流，不是密码错。** 等 30~60 秒再试即可。

---

## 5. 我犯的错误（也有教育意义）

写教程只写成功经验是不完整的，这几个错误更能说明问题。

| 错误 | 表现 | 教训 |
|---|---|---|
| **测试脚本打错端口** | 80 端口测 `/api/health` 得到 301，一度以为反代没配好。实际是我把 80 配成了"除 ACME 外全跳转"，**301 正是预期行为** | 测试前先想清楚"**这个请求应该得到什么**"。不知道预期结果，就无法解读实际结果 |
| **环境变量名写错** | `STATS_PASSWORD` vs `STATICS_PASSWORD`，grep 不到，第一反应是"文件有问题" | 报"找不到"时，先怀疑自己写错了，再怀疑环境 |
| **`timeout` 强杀 certbot** | 留下锁文件，导致后续 3 次尝试全部假失败 | 强杀有状态的服务前，先确认它的清理机制 |
| **误判 SSH 限流为密码错误** | 差点去改 `.zshrc` 里的密码 | 多一层验证（同时测 HTTP），就能立刻区分 |
| **假设旧部署脚本能用** | 仓库里的 `scripts/deploy-server.sh` 是 Debian 写法（`sites-available`、`certbot --nginx`、`vite preview`），在这台 RHEL 系的机器上根本跑不通 | **仓库里的脚本不代表线上能跑**。要读它、验证它，或者重写 |
| **把"众所周知"当成"已验证"** | 我在文档初稿里断言 `proxy_pass_header Set-Cookie` 是必需的，实际做了对照实验后发现 nginx 默认就透传，那行是多余的 | **"加了能工作" ≠ "因为加了才能工作"**。凭印象写技术结论，等于把错误传播给下一个读文档的人 |

**最后一条特别值得展开**：那个脚本写得很完整、很规范，格式漂亮，读起来像模像样。
但它在**这台机器上完全不可用**——发行版不对、certbot 安装方式不对、托管方式也过时了。

> **判断一个脚本能不能用，看的是它的假设是否成立，不是它的代码是否漂亮。**

---

## 6. 可迁移的经验清单

把这次学到的东西抽象出来，换任何服务器、任何项目都用得上：

### 部署前
1. **先勘察，再动手**。发行版家族、运行时路径、已占端口、服务的启动方式——这四项决定了后面所有配置怎么写
2. **看代码，别猜配置**。`.env` 里可能有废弃变量；仓库里的脚本可能已经过时

### 架构选型
3. **静态资源交给 nginx，不要用应用服务器兜**
4. **长期进程交给 systemd**，不要 `nohup` + pid 文件
5. **让工具改配置要谨慎**（如 `certbot --nginx`）。配置的所有权应该明确
6. **配置来源越少越好**，别让 dotenv 和 systemd 都管 `.env`

### 写配置
7. **部署路径顺着服务用户的权限走**（`/root` 550 → 用 `/var/www`）
8. **不迷信"语法检查通过"**。`nginx -t` 通过只代表语法对，不代表语义对（403/404 都是语义问题）

### 调试
9. **分层验证**：后端 → 本机 nginx（用 `-H 'Host: 域名'`）→ 本机 HTTPS → 公网
10. **区分故障层**：报错发生在"外部到你的服务"还是"你的服务内部"，处理方式完全不同
11. **警惕假阴性**：失败原因"为空"本身就是信号；别用 `timeout` 强杀有锁的程序
12. **偶发失败用概率思维**：算清单次成功率和重试次数，再决定投入多少工程成本治根因
13. **验证假设用对照实验，并隔离变量**——起个临时实例，别拿生产做 A/B。
    "加了之后能工作"不等于"因为加了才能工作"

### 工程习惯
13. **部署脚本要幂等**，能反复执行
14. **每个"不显然的决定"都要在文档里写下原因**。三个月后的你不会记得为什么 `location ^~` 必须加 `^~`
15. **上线后立刻验证那些"很久以后才会出问题"的环节**——比如证书续期，别等 90 天后才发现 301 把校验吃掉了

---

## 7. 附：命令速查

```bash
# ── 服务状态 ──────────────────────────────
systemctl status nginx pingdou-backend certbot-renew.timer
systemctl is-enabled nginx pingdou-backend        # 开机自启了吗
ss -lntp | grep -E ':80|:443|:3000'               # 实际监听端口

# ── 分层验证 ──────────────────────────────
curl -s localhost:3000/api/health                          # 后端活着吗
curl -s -H 'Host: xn--muu023g.xyz' http://127.0.0.1/       # nginx 路由对吗
curl -sk -H 'Host: xn--muu023g.xyz' https://127.0.0.1/     # HTTPS 配置对吗
curl -s https://xn--muu023g.xyz/                           # 证书可信吗

# ── 证书 ──────────────────────────────────
certbot certificates                                       # 还有多久过期
certbot renew --dry-run                                    # 演练续期（单次失败是正常的）
echo | openssl s_client -servername 域名 -connect 域名:443 2>/dev/null | openssl x509 -noout -dates

# ── 排错 ──────────────────────────────────
journalctl -u pingdou-backend -n 50 --no-pager
nginx -t                                                   # 只查语法，不查语义
ps -eo pid,ppid,user,cmd | grep <服务名>                    # ppid=1 且非 systemd 起 → 裸进程
```

---

## 8. 一句话总结

> **部署的难点从来不是敲对命令，而是搞清楚"这台机器现在是什么状态"、"这个报错发生在哪一层"、
> 以及"这个决定为什么这么定"。**
> 命令可以查，这三个问题只能靠勘察、分层验证和写文档。
