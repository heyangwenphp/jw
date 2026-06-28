#!/usr/bin/env bash

set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

PORT="${PORT:-${JEDI_WEB_PORT:-${BACKEND_PORT:-3456}}}"
NODE_ENV="${NODE_ENV:-production}"
JEDI_WEB_DATA_DIR="${JEDI_WEB_DATA_DIR:-/data/datas}"
LOG_DIR="$JEDI_WEB_DATA_DIR/logs"
PUBLIC_PAGE="/pages/main/index.html"
HEALTH_PATH="/api/health"
DIST_ENTRY="$APP_DIR/dist$PUBLIC_PAGE"
PM2_APP_NAME="${PM2_APP_NAME:-jedi-web}"
SERVER_SCRIPT="$APP_DIR/server/index.js"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-30}"
SKIP_NPM_INSTALL="${SKIP_NPM_INSTALL:-0}"

cd "$APP_DIR"
mkdir -p "$LOG_DIR"

export PORT
export NODE_ENV
export JEDI_WEB_DATA_DIR

need_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd" >&2
    exit 1
  fi
}

require_node_runtime() {
  need_cmd node
  need_cmd npm
}

require_pm2() {
  need_cmd pm2
}

public_url() {
  if [ -n "${PUBLIC_URL:-}" ]; then
    printf "%s" "${PUBLIC_URL%/}"
  else
    printf "http://localhost:%s" "$PORT"
  fi
}

health_url() {
  printf "http://127.0.0.1:%s%s" "$PORT" "$HEALTH_PATH"
}

page_url() {
  printf "%s%s" "$(public_url)" "$PUBLIC_PAGE"
}

warn_public_url_path() {
  case "${PUBLIC_URL:-}" in
    http://*/*|https://*/*)
      echo "Warning: PUBLIC_URL contains a path. This project builds assets for domain-root deployment."
      echo "         Prefer PUBLIC_URL=https://host or set VITE_API_BASE/VITE_SOCKET_URL explicitly."
      ;;
  esac
}

build_frontend() {
  require_node_runtime

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

  warn_public_url_path

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
    echo "  The web client will resolve API and Socket.io URLs from window.location.origin."
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

install_deps() {
  require_node_runtime

  if [ -f "$APP_DIR/package-lock.json" ]; then
    echo "Installing dependencies with npm ci..."
    npm ci
  else
    echo "Installing dependencies with npm install..."
    npm install
  fi

  echo "Rebuilding native modules when configured..."
  npm run rebuild:sqlite --if-present
}

ensure_dist() {
  if [ -f "$DIST_ENTRY" ]; then
    return
  fi

  echo "dist entry not found, building frontend first..."
  build_frontend
}

pm2_has_app() {
  require_pm2
  pm2 describe "$PM2_APP_NAME" >/dev/null 2>&1
}

pm2_start_fresh() {
  require_node_runtime
  require_pm2
  ensure_dist

  echo "Starting Jedi Web via PM2 on port $PORT..."
  env PORT="$PORT" NODE_ENV="$NODE_ENV" JEDI_WEB_DATA_DIR="$JEDI_WEB_DATA_DIR" pm2 start "$SERVER_SCRIPT" \
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
  echo "URL: $(page_url)"
}

pm2_start() {
  require_pm2
  ensure_dist

  if pm2_has_app; then
    echo "Jedi Web already exists in PM2. Restarting with updated environment..."
    pm2_restart
    return
  fi

  pm2_start_fresh
}

pm2_restart() {
  require_node_runtime
  require_pm2
  ensure_dist

  if pm2_has_app; then
    echo "Restarting Jedi Web (PM2 $PM2_APP_NAME) on port $PORT..."
    env PORT="$PORT" NODE_ENV="$NODE_ENV" JEDI_WEB_DATA_DIR="$JEDI_WEB_DATA_DIR" pm2 restart "$PM2_APP_NAME" --update-env
    pm2 save
    echo "URL: $(page_url)"
  else
    pm2_start_fresh
  fi
}

pm2_stop() {
  require_pm2

  if ! pm2_has_app; then
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
  require_pm2

  if pm2_has_app; then
    echo "Jedi Web running (PM2):"
    pm2 show "$PM2_APP_NAME" 2>/dev/null || pm2 list
    echo "URL: $(page_url)"
  else
    echo "Jedi Web stopped (PM2 $PM2_APP_NAME not found)"
  fi

  if [ -f "$DIST_ENTRY" ]; then
    echo "dist: ready ($DIST_ENTRY)"
  else
    echo "dist: missing ($DIST_ENTRY)"
  fi
}

pm2_logs() {
  require_pm2
  pm2 logs "$PM2_APP_NAME" --lines 50 --nostream
}

health() {
  need_cmd curl
  curl -fsS "$(health_url)"
  echo
}

wait_for_health() {
  need_cmd curl

  local url deadline
  url="$(health_url)"
  deadline=$((SECONDS + HEALTH_TIMEOUT))

  echo "Waiting for health check: $url"
  until curl -fsS "$url" >/dev/null 2>&1; do
    if [ "$SECONDS" -ge "$deadline" ]; then
      echo "Health check failed after ${HEALTH_TIMEOUT}s: $url" >&2
      echo "Run 'bash deploy.sh logs' for recent PM2 logs." >&2
      return 1
    fi
    sleep 1
  done
  echo "Health check passed."
}

deploy() {
  build_frontend
  pm2_restart
  wait_for_health
}

rebuild() {
  build_frontend
  echo "Frontend rebuilt. Restarting server..."
  pm2_restart
  wait_for_health
}

print_config() {
  echo "APP_DIR=$APP_DIR"
  echo "SERVER_SCRIPT=$SERVER_SCRIPT"
  echo "DIST_ENTRY=$DIST_ENTRY"
  echo "PM2_APP_NAME=$PM2_APP_NAME"
  echo "PORT=$PORT"
  echo "NODE_ENV=$NODE_ENV"
  echo "PUBLIC_URL=${PUBLIC_URL:-}"
  echo "JEDI_WEB_DATA_DIR=${JEDI_WEB_DATA_DIR:-}"
  echo "JEDI_WEB_USE_PROJECT_DATA_DIR=${JEDI_WEB_USE_PROJECT_DATA_DIR:-}"
  echo "JEDI_WEB_SECURE_COOKIE=${JEDI_WEB_SECURE_COOKIE:-}"
  echo "SKIP_NPM_INSTALL=$SKIP_NPM_INSTALL"
  echo "URL=$(page_url)"
  echo "HEALTH=$(health_url)"
}

usage() {
  cat <<'EOF'
Usage: bash deploy.sh {deploy|install|build|start|stop|restart|rebuild|status|health|logs|config}

Commands:
  deploy    Build frontend, restart PM2, then wait for /api/health
  install   Install npm dependencies and rebuild better-sqlite3 when configured
  build     Build frontend only
  start     Start PM2, or restart it if the app already exists
  stop      Stop and delete the PM2 app entry
  restart   Restart PM2 with --update-env, or start if missing
  rebuild   Build frontend and restart PM2 with --update-env
  status    Show PM2 status and dist readiness
  health    Call local /api/health
  logs      Show recent PM2 logs
  config    Print resolved deployment configuration

Examples:
  bash deploy.sh
  PUBLIC_URL=https://jw.gsdata.cn bash deploy.sh
  PORT=3456 JEDI_WEB_DATA_DIR=/srv/jedi-web-data bash deploy.sh
  SKIP_NPM_INSTALL=1 bash deploy.sh
  PORT=4000 bash deploy.sh restart
EOF
}

case "${1:-deploy}" in
  deploy)
    deploy
    ;;
  install|deps)
    install_deps
    ;;
  build)
    build_frontend
    ;;
  start)
    pm2_start
    wait_for_health
    ;;
  stop)
    pm2_stop
    ;;
  restart)
    pm2_restart
    wait_for_health
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
  config)
    print_config
    ;;
  help|-h|--help)
    usage
    ;;
  *)
    usage
    exit 1
    ;;
esac
