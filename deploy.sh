#!/usr/bin/env bash

set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$APP_DIR/logs"

PORT="${PORT:-${BACKEND_PORT:-3456}}"
DIST_ENTRY="$APP_DIR/dist/pages/main/index.html"
PM2_APP_NAME="${PM2_APP_NAME:-jedi-web}"
SERVER_SCRIPT="$APP_DIR/server/index.js"

cd "$APP_DIR"
mkdir -p "$LOG_DIR"

public_url() {
  if [ -n "${PUBLIC_URL:-}" ]; then
    printf "%s" "${PUBLIC_URL%/}"
  else
    printf "http://localhost:%s" "$PORT"
  fi
}

build_frontend() {
  local default_url api_base socket_url
  default_url="$(public_url)"
  api_base="${VITE_API_BASE:-}"
  socket_url="${VITE_SOCKET_URL:-}"

  if [ -z "$api_base" ] && [ -n "${PUBLIC_URL:-}" ]; then
    api_base="$default_url"
  fi

  if [ -z "$socket_url" ] && [ -n "$api_base" ]; then
    socket_url="$api_base"
  fi

  echo "Building frontend..."
  if [ -n "$api_base" ]; then
    echo "  VITE_API_BASE=$api_base"
  else
    echo "  VITE_API_BASE=(runtime page origin)"
  fi
  if [ -n "$socket_url" ]; then
    echo "  VITE_SOCKET_URL=$socket_url"
  else
    echo "  VITE_SOCKET_URL=(runtime page origin)"
  fi
  if [ -z "$api_base" ] && [ -z "$socket_url" ]; then
    echo "  Let the web client resolve API URLs from window.location.origin."
  fi

  run_build_command "$api_base" "$socket_url"
}

run_build_command() {
  local api_base="$1"
  local socket_url="$2"
  local env_args=()

  if [ -n "$api_base" ]; then
    env_args+=("VITE_API_BASE=$api_base")
  fi
  if [ -n "$socket_url" ]; then
    env_args+=("VITE_SOCKET_URL=$socket_url")
  fi

  if [ "${#env_args[@]}" -gt 0 ]; then
    env "${env_args[@]}" npm run build
  else
    npm run build
  fi
}

ensure_dist() {
  if [ -f "$DIST_ENTRY" ]; then
    return
  fi

  echo "dist entry not found, building frontend first..."
  build_frontend
}

# ──────────────────────────────
# PM2 管理
# ──────────────────────────────

pm2_start() {
  ensure_dist

  # 先停掉旧实例（如果有）
  if pm2 list 2>/dev/null | grep -q "$PM2_APP_NAME"; then
    pm2 delete "$PM2_APP_NAME" 2>/dev/null || true
  fi

  echo "Starting Jedi Web via PM2 on port $PORT..."
  PORT="$PORT" pm2 start "$SERVER_SCRIPT" \
    --name "$PM2_APP_NAME" \
    --cwd "$APP_DIR" \
    --log "$LOG_DIR/jedi-web.log" \
    --error "$LOG_DIR/jedi-web-error.log" \
    --output "$LOG_DIR/jedi-web-out.log" \
    --time \
    --restart-delay=3000 \
    --max-restarts=10

  pm2 save
  echo "PID via PM2: $(pm2 pid "$PM2_APP_NAME" 2>/dev/null || echo 'starting...')"
  echo "URL: $(public_url)/pages/main/index.html"
}

pm2_stop() {
  if ! pm2 list 2>/dev/null | grep -q "$PM2_APP_NAME"; then
    echo "Jedi Web (PM2 $PM2_APP_NAME) is not running"
    return
  fi

  echo "Stopping Jedi Web (PM2 $PM2_APP_NAME)..."
  pm2 stop "$PM2_APP_NAME"
  pm2 delete "$PM2_APP_NAME" 2>/dev/null || true
  pm2 save
  echo "Stopped."
}

pm2_status() {
  if pm2 list 2>/dev/null | grep -q "$PM2_APP_NAME"; then
    echo "Jedi Web running (PM2):"
    pm2 show "$PM2_APP_NAME" 2>/dev/null || pm2 list
    echo "URL: $(public_url)/pages/main/index.html"
  else
    echo "Jedi Web stopped (PM2 $PM2_APP_NAME not found)"
  fi

  if [ -f "$DIST_ENTRY" ]; then
    echo "dist: ready"
  else
    echo "dist: missing"
  fi
}

pm2_logs() {
  pm2 logs "$PM2_APP_NAME" --lines 50 --nostream
}

# ──────────────────────────────
# 部署 / 重启
# ──────────────────────────────

deploy() {
  build_frontend
  pm2_start
}

restart() {
  pm2_stop
  pm2_start
}

rebuild() {
  build_frontend
  echo "Frontend rebuilt. Restarting server..."
  pm2 restart "$PM2_APP_NAME" 2>/dev/null || pm2_start
}

health() {
  curl -fsS "http://127.0.0.1:$PORT/api/health"
  echo
}

case "${1:-deploy}" in
  deploy)
    deploy
    ;;
  build)
    build_frontend
    ;;
  start)
    pm2_start
    ;;
  stop)
    pm2_stop
    ;;
  restart)
    restart
    ;;
  rebuild)
    rebuild
    ;;
  status)
    pm2_status
    ;;
  health)
    health
    ;;
  logs)
    pm2_logs
    ;;
  *)
    echo "Usage: bash deploy.sh {deploy|build|start|stop|restart|rebuild|status|health|logs}"
    echo
    echo "Examples:"
    echo "  PUBLIC_URL=http://kc.newmin.cn bash deploy.sh deploy"
    echo "  PUBLIC_URL=http://SERVER_IP:3456 bash deploy.sh deploy"
    echo "  bash deploy.sh rebuild   # 只重新构建前端并重启"
    exit 1
    ;;
esac
