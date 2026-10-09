#!/usr/bin/env bash
# =====================================================================
#  拼豆.xyz 重新部署脚本 —— 在服务器上执行
#
#  服务器:   120.26.57.141  (Alibaba Cloud Linux 4)
#  项目目录: /root/project/pingdou
#
#  用法（在服务器上）:
#      bash /root/project/pingdou/scripts/deploy-server.sh
#
#  本脚本负责「代码已就位后重新构建并发布」，可反复执行（幂等）。
#  首次部署（装 node / nginx / certbot / 签证书 / 配 systemd）的完整
#  步骤见 docs/DEPLOY.md。
# =====================================================================
set -euo pipefail

APP_DIR=/root/project/pingdou
WWW_ROOT=/var/www/pingdou
BACKEND_PORT=3000
SITE=https://xn--muu023g.xyz          # 拼豆.xyz 的 punycode

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info() { echo -e "${GREEN}[✔]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
err()  { echo -e "${RED}[✘]${NC} $*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || err "需要 root 权限执行"

echo "=========================================="
echo " [1/6] 准备 node 环境"
echo "=========================================="
# node 由 nvm 安装，不在 root 的非交互 PATH 里，需要显式补上
NODE_BIN=$(ls -d /root/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -1)
[[ -n "$NODE_BIN" ]] || err "未找到 /root/.nvm/versions/node/*/bin 下的 node"
export PATH="$NODE_BIN:$PATH"
info "node $(node -v)  ($NODE_BIN)"

cd "$APP_DIR"

echo "=========================================="
echo " [2/6] 安装依赖"
echo "=========================================="
if [[ -d node_modules ]]; then
  info "node_modules 已存在，跳过（依赖有变动时请先 rm -rf node_modules 再跑）"
else
  npm install
  info "依赖安装完成"
fi

echo "=========================================="
echo " [3/6] 构建前后端"
echo "=========================================="
npm run build:server      # 后端 -> dist-server/
npm run build             # 前端 -> dist/
info "构建完成"

echo "=========================================="
echo " [4/6] 发布静态文件"
echo "=========================================="
# nginx 的 worker 进程以 nginx 用户运行，而 /root 目录权限是 550，
# nginx 无法穿透进去读文件，所以产物必须复制到 /var/www 下托管。
mkdir -p "$WWW_ROOT"
rm -rf "${WWW_ROOT:?}"/*
cp -a "$APP_DIR/dist/." "$WWW_ROOT/"
chmod -R a+rX "$WWW_ROOT"
info "已发布 $(find "$WWW_ROOT" -type f | wc -l) 个文件 -> $WWW_ROOT"

echo "=========================================="
echo " [5/6] 重启后端 + 重载 nginx"
echo "=========================================="
systemctl restart pingdou-backend
sleep 3
if ! systemctl is-active --quiet pingdou-backend; then
  journalctl -u pingdou-backend -n 40 --no-pager
  err "后端启动失败，见上面日志"
fi
info "pingdou-backend: active"

nginx -t
systemctl reload nginx
info "nginx 已重载"

echo "=========================================="
echo " [6/6] 验证"
echo "=========================================="
sleep 1
printf "  /api/health   -> %s\n" "$(curl -s --max-time 5 "http://127.0.0.1:$BACKEND_PORT/api/health" || echo '无响应')"
printf "  HTTPS 首页    -> HTTP %s\n" "$(curl -sk -o /dev/null -w '%{http_code}' --max-time 10 "$SITE/")"
printf "  HTTP 跳转     -> HTTP %s\n" "$(curl -s  -o /dev/null -w '%{http_code}' --max-time 10 "http://${SITE#https://}/")"
echo
info "部署完成：$SITE"
