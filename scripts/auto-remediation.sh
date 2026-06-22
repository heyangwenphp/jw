#!/usr/bin/env bash
set -uo pipefail

# Jedi auto-remediation entrypoint for cron.
#
# Default behavior is intentionally conservative:
# - Run read-only checks.
# - Auto-fix low-risk P3 issues with known playbooks.
# - Use non-destructive PM2 restart; never delete the running app automatically.
# - Stop and notify when a fix fails, preserving logs for manual diagnosis.

APP_DIR="${JEDI_APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
PORT="${PORT:-${BACKEND_PORT:-3456}}"
PM2_APP_NAME="${PM2_APP_NAME:-jedi-web}"
DEPLOY_SCRIPT="${DEPLOY_SCRIPT:-$APP_DIR/deploy.sh}"
PUBLIC_HEALTH_URL="${PUBLIC_HEALTH_URL:-http://127.0.0.1:$PORT/api/health}"
DIST_ENTRY="${DIST_ENTRY:-$APP_DIR/dist/pages/main/index.html}"

STATE_DIR="${AUTO_REMEDIATION_STATE_DIR:-$APP_DIR/logs/auto-remediation}"
LOG_FILE="${AUTO_REMEDIATION_LOG_FILE:-$STATE_DIR/auto-remediation.log}"
EVENTS_FILE="${AUTO_REMEDIATION_EVENTS_FILE:-$STATE_DIR/events.jsonl}"
LOCK_DIR="${AUTO_REMEDIATION_LOCK_DIR:-$STATE_DIR/lock}"

AUTO_FIX="${AUTO_FIX:-1}"
ENABLE_SAFE_RESTART="${ENABLE_SAFE_RESTART:-1}"
ENABLE_DIST_FIX="${ENABLE_DIST_FIX:-1}"
ENABLE_DAILY_REPORT_FIX="${ENABLE_DAILY_REPORT_FIX:-1}"
ENABLE_WECHAT_COLLECTOR_FIX="${ENABLE_WECHAT_COLLECTOR_FIX:-0}"
ENABLE_SAFE_DEPLOY="${ENABLE_SAFE_DEPLOY:-0}"

MIN_RESTART_INTERVAL_SECONDS="${MIN_RESTART_INTERVAL_SECONDS:-1800}"
MIN_DEPLOY_INTERVAL_SECONDS="${MIN_DEPLOY_INTERVAL_SECONDS:-3600}"
HEALTH_RETRIES="${HEALTH_RETRIES:-5}"
HEALTH_RETRY_DELAY_SECONDS="${HEALTH_RETRY_DELAY_SECONDS:-5}"
COMMAND_TIMEOUT_SECONDS="${COMMAND_TIMEOUT_SECONDS:-1800}"

DAILY_REPORT_DIR="${DAILY_REPORT_DIR:-/home/jedi/jedi-web-agent-output/reports/daily}"
DAILY_REPORT_MIN_KB="${DAILY_REPORT_MIN_KB:-5}"
DAILY_REPORT_CHECK_AFTER_HOUR="${DAILY_REPORT_CHECK_AFTER_HOUR:-2}"

WECHAT_DB_PATH="${WECHAT_DB_PATH:-/www/jedi_web/wechat_765.sqlite}"
WECHAT_COLLECTOR_BATCH_START="${WECHAT_COLLECTOR_BATCH_START:-13:30:00}"
WECHAT_COLLECTOR_BATCH_END="${WECHAT_COLLECTOR_BATCH_END:-14:15:00}"

NOTIFY_WEBHOOK_URL="${NOTIFY_WEBHOOK_URL:-}"
FEISHU_BOT_WEBHOOK="${FEISHU_BOT_WEBHOOK:-}"
AUTO_REMEDIATION_NOTIFY_CMD="${AUTO_REMEDIATION_NOTIFY_CMD:-}"

declare -a EVENTS=()
declare -a ACTIONS=()
RUN_ID="remed_$(date '+%Y%m%d_%H%M%S')_$$"
EXIT_CODE=0
FIX_APPLIED=0
DEPLOY_REQUIRED=0
STOP_AUTOMATION=0

mkdir -p "$STATE_DIR"

log() {
  local message="$1"
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$message" | tee -a "$LOG_FILE"
}

json_escape() {
  if command -v node >/dev/null 2>&1; then
    node -e 'process.stdout.write(JSON.stringify(process.argv[1] || ""))' "$1"
  else
    printf '"%s"' "$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g')"
  fi
}

write_event_jsonl() {
  local severity="$1"
  local category="$2"
  local summary="$3"
  local action="$4"
  local status="${5:-detected}"

  {
    printf '{'
    printf '"time":%s,' "$(json_escape "$(date '+%Y-%m-%dT%H:%M:%S%z')")"
    printf '"run_id":%s,' "$(json_escape "$RUN_ID")"
    printf '"severity":%s,' "$(json_escape "$severity")"
    printf '"category":%s,' "$(json_escape "$category")"
    printf '"summary":%s,' "$(json_escape "$summary")"
    printf '"action":%s,' "$(json_escape "$action")"
    printf '"status":%s' "$(json_escape "$status")"
    printf '}\n'
  } >> "$EVENTS_FILE"
}

add_event() {
  local severity="$1"
  local category="$2"
  local summary="$3"
  local action="$4"
  local status="${5:-detected}"
  EVENTS+=("$severity|$category|$summary|$action|$status")
  write_event_jsonl "$severity" "$category" "$summary" "$action" "$status"
  log "[$severity][$category] $summary -> $action"
}

add_action() {
  local action="$1"
  ACTIONS+=("$action")
  log "[action] $action"
}

have_command() {
  command -v "$1" >/dev/null 2>&1
}

run_cmd() {
  local label="$1"
  shift
  add_action "$label"

  if have_command timeout; then
    timeout "$COMMAND_TIMEOUT_SECONDS" "$@"
  else
    "$@"
  fi
}

health_ok() {
  curl -fsS --max-time 5 "$PUBLIC_HEALTH_URL" >/dev/null 2>&1
}

wait_for_health() {
  local attempt
  for ((attempt = 1; attempt <= HEALTH_RETRIES; attempt += 1)); do
    if health_ok; then
      return 0
    fi
    sleep "$HEALTH_RETRY_DELAY_SECONDS"
  done
  return 1
}

pm2_app_exists() {
  have_command pm2 && pm2 pid "$PM2_APP_NAME" >/dev/null 2>&1
}

pm2_app_pid() {
  if ! have_command pm2; then
    printf ''
    return
  fi
  pm2 pid "$PM2_APP_NAME" 2>/dev/null | tr -d '[:space:]' || true
}

mark_file() {
  local name="$1"
  printf '%s\n' "$(date '+%s')" > "$STATE_DIR/$name"
}

last_mark_age_seconds() {
  local name="$1"
  local path="$STATE_DIR/$name"
  local now last
  now="$(date '+%s')"
  if [[ ! -f "$path" ]]; then
    printf '999999999'
    return
  fi
  last="$(cat "$path" 2>/dev/null || printf '0')"
  if ! [[ "$last" =~ ^[0-9]+$ ]]; then
    printf '999999999'
    return
  fi
  printf '%s' "$((now - last))"
}

send_notification() {
  local text="$1"

  log "[notify] $(printf '%s' "$text" | head -c 180)"

  if [[ -n "$AUTO_REMEDIATION_NOTIFY_CMD" ]]; then
    JEDI_NOTIFY_TEXT="$text" bash -lc "$AUTO_REMEDIATION_NOTIFY_CMD" >> "$LOG_FILE" 2>&1 || true
  fi

  if [[ -n "$FEISHU_BOT_WEBHOOK" ]] && have_command curl && have_command node; then
    TEXT="$text" node - <<'NODE' | curl -fsS -X POST -H 'Content-Type: application/json' -d @- "$FEISHU_BOT_WEBHOOK" >> "$LOG_FILE" 2>&1 || true
const text = process.env.TEXT || ''
process.stdout.write(JSON.stringify({
  msg_type: 'text',
  content: { text }
}))
NODE
  fi

  if [[ -n "$NOTIFY_WEBHOOK_URL" ]] && have_command curl && have_command node; then
    TEXT="$text" node - <<'NODE' | curl -fsS -X POST -H 'Content-Type: application/json' -d @- "$NOTIFY_WEBHOOK_URL" >> "$LOG_FILE" 2>&1 || true
const text = process.env.TEXT || ''
process.stdout.write(JSON.stringify({ text }))
NODE
  fi
}

collect_pm2_snapshot() {
  if ! have_command pm2; then
    log "pm2 not found; skip pm2 snapshot"
    return
  fi
  pm2 show "$PM2_APP_NAME" > "$STATE_DIR/pm2-show-before-$RUN_ID.txt" 2>&1 || true
  pm2 logs "$PM2_APP_NAME" --lines 100 --nostream > "$STATE_DIR/pm2-logs-before-$RUN_ID.txt" 2>&1 || true
}

safe_restart_service() {
  if [[ "$ENABLE_SAFE_RESTART" != "1" ]]; then
    add_event "P1" "service_unhealthy" "健康检查失败，但 ENABLE_SAFE_RESTART 未开启" "manual_intervention" "blocked"
    STOP_AUTOMATION=1
    return 1
  fi

  local age
  age="$(last_mark_age_seconds "last-safe-restart.at")"
  if [[ "$age" -lt "$MIN_RESTART_INTERVAL_SECONDS" ]]; then
    add_event "P1" "restart_cooldown" "距离上次自动重启 ${age}s，低于冷却阈值 ${MIN_RESTART_INTERVAL_SECONDS}s" "manual_intervention" "blocked"
    STOP_AUTOMATION=1
    return 1
  fi

  collect_pm2_snapshot
  mark_file "last-safe-restart.at"

  if pm2_app_exists; then
    local before_pid
    before_pid="$(pm2_app_pid)"
    add_event "P3" "service_unhealthy" "服务健康检查失败，尝试非破坏性 pm2 restart；旧 PID=${before_pid:-unknown}" "pm2_restart" "fixing"
    if ! run_cmd "pm2 restart $PM2_APP_NAME --update-env" pm2 restart "$PM2_APP_NAME" --update-env >> "$LOG_FILE" 2>&1; then
      add_event "P0" "service_restart_failed" "pm2 restart 执行失败" "manual_intervention" "failed"
      STOP_AUTOMATION=1
      return 1
    fi
  else
    add_event "P3" "service_not_running" "PM2 中未找到 $PM2_APP_NAME，尝试 deploy.sh start" "deploy_start" "fixing"
    if [[ ! -x "$DEPLOY_SCRIPT" ]]; then
      chmod +x "$DEPLOY_SCRIPT" 2>/dev/null || true
    fi
    if ! run_cmd "bash deploy.sh start" bash "$DEPLOY_SCRIPT" start >> "$LOG_FILE" 2>&1; then
      add_event "P0" "service_start_failed" "deploy.sh start 执行失败" "manual_intervention" "failed"
      STOP_AUTOMATION=1
      return 1
    fi
  fi

  if wait_for_health; then
    add_event "P3" "service_recovered" "服务已通过健康检查" "none" "resolved"
    FIX_APPLIED=1
    return 0
  fi

  if have_command pm2; then
    add_event "P1" "service_health_failed_after_restart" "重启后健康检查仍失败，尝试 pm2 resurrect 一次" "pm2_resurrect" "fixing"
    pm2 resurrect >> "$LOG_FILE" 2>&1 || true
    if wait_for_health; then
      add_event "P2" "service_recovered_by_resurrect" "pm2 resurrect 后服务恢复" "none" "resolved"
      FIX_APPLIED=1
      return 0
    fi
  fi

  add_event "P0" "service_down" "自动恢复失败，已停止继续操作并保留现场日志" "manual_intervention" "failed"
  STOP_AUTOMATION=1
  return 1
}

fix_missing_dist() {
  if [[ "$ENABLE_DIST_FIX" != "1" ]]; then
    add_event "P2" "dist_missing" "前端 dist 缺失，但 ENABLE_DIST_FIX 未开启" "manual_intervention" "blocked"
    return 1
  fi

  add_event "P3" "dist_missing" "未找到 $DIST_ENTRY，尝试重新构建前端资源" "npm_run_build" "fixing"
  if ! run_cmd "npm run build" npm run build >> "$LOG_FILE" 2>&1; then
    add_event "P1" "build_failed" "前端构建失败，禁止继续部署或重启" "manual_intervention" "failed"
    STOP_AUTOMATION=1
    return 1
  fi

  if [[ ! -f "$DIST_ENTRY" ]]; then
    add_event "P1" "dist_still_missing" "构建完成后 dist 入口仍不存在" "manual_intervention" "failed"
    STOP_AUTOMATION=1
    return 1
  fi

  add_event "P3" "dist_rebuilt" "前端资源已重新生成" "safe_restart_if_needed" "resolved"
  FIX_APPLIED=1
  DEPLOY_REQUIRED=1
  return 0
}

yesterday_label() {
  date -d "yesterday" "+%Y年%-m月%-d日" 2>/dev/null || date -v-1d "+%Y年%m月%d日"
}

yesterday_iso() {
  date -d "yesterday" "+%Y-%m-%d" 2>/dev/null || date -v-1d "+%Y-%m-%d"
}

check_daily_report() {
  if [[ "$ENABLE_DAILY_REPORT_FIX" != "1" ]]; then
    return 0
  fi

  local hour
  hour="$(date '+%H')"
  hour="$((10#$hour))"
  if [[ "$hour" -lt "$DAILY_REPORT_CHECK_AFTER_HOUR" ]]; then
    return 0
  fi

  local label expected_file size_kb date_key attempt_marker
  label="$(yesterday_label)"
  date_key="$(yesterday_iso)"
  expected_file="$DAILY_REPORT_DIR/日报(${label}).md"
  attempt_marker="daily-report-fix-$date_key.at"

  if [[ -f "$expected_file" ]]; then
    size_kb="$(( $(wc -c < "$expected_file" 2>/dev/null || echo 0) / 1024 ))"
    if [[ "$size_kb" -ge "$DAILY_REPORT_MIN_KB" ]]; then
      return 0
    fi
    add_event "P3" "daily_report_too_small" "日报文件偏小：$expected_file (${size_kb}KB)" "regenerate_daily_report" "detected"
  else
    add_event "P3" "daily_report_missing" "日报文件不存在：$expected_file" "regenerate_daily_report" "detected"
  fi

  if [[ "$(last_mark_age_seconds "$attempt_marker")" -lt 86400 ]]; then
    add_event "P2" "daily_report_fix_cooldown" "今天已经尝试过自动重生日报，避免重复触发" "manual_intervention" "blocked"
    return 1
  fi

  mark_file "$attempt_marker"

  if [[ "$AUTO_FIX" != "1" ]]; then
    add_event "P3" "daily_report_fix_disabled" "AUTO_FIX 未开启，跳过日报自动修复" "manual_intervention" "blocked"
    return 1
  fi

  add_event "P3" "daily_report_regenerate" "开始自动重生日报：$label" "npm_run_trigger_daily_report" "fixing"
  if ! run_cmd "npm run trigger:daily-report" npm run trigger:daily-report >> "$LOG_FILE" 2>&1; then
    add_event "P2" "daily_report_regenerate_failed" "日报重生命令失败" "manual_intervention" "failed"
    return 1
  fi

  if [[ ! -f "$expected_file" ]]; then
    add_event "P2" "daily_report_still_missing" "重跑后日报仍不存在：$expected_file" "manual_intervention" "failed"
    return 1
  fi

  size_kb="$(( $(wc -c < "$expected_file" 2>/dev/null || echo 0) / 1024 ))"
  if [[ "$size_kb" -lt "$DAILY_REPORT_MIN_KB" ]]; then
    add_event "P2" "daily_report_still_too_small" "重跑后日报仍偏小：${size_kb}KB" "manual_intervention" "failed"
    return 1
  fi

  add_event "P3" "daily_report_recovered" "日报已生成：$expected_file (${size_kb}KB)" "none" "resolved"
  FIX_APPLIED=1
  return 0
}

check_wechat_collector() {
  if [[ "$ENABLE_WECHAT_COLLECTOR_FIX" != "1" ]]; then
    return 0
  fi

  if [[ ! -f "$WECHAT_DB_PATH" ]]; then
    add_event "P1" "wechat_db_missing" "微信采集数据库不存在：$WECHAT_DB_PATH" "manual_intervention" "failed"
    return 1
  fi

  if ! have_command sqlite3; then
    add_event "P4" "sqlite3_missing" "未安装 sqlite3，跳过微信采集数据库巡检" "install_sqlite3_or_use_node_checker" "blocked"
    return 0
  fi

  local today start end count marker
  today="$(date '+%Y-%m-%d')"
  start="${today}T${WECHAT_COLLECTOR_BATCH_START}"
  end="${today}T${WECHAT_COLLECTOR_BATCH_END}"
  count="$(sqlite3 "$WECHAT_DB_PATH" "SELECT COUNT(*) FROM wechat_articles WHERE collected_at >= '$start' AND collected_at < '$end';" 2>/dev/null || echo 0)"

  if [[ "$count" != "0" ]]; then
    return 0
  fi

  marker="wechat-collector-fix-$today.at"
  add_event "P2" "wechat_collection_empty" "今日采集窗口 $start - $end 入库数为 0" "rerun_wechat_collector_once" "detected"

  if [[ "$(last_mark_age_seconds "$marker")" -lt 86400 ]]; then
    add_event "P1" "wechat_collection_fix_cooldown" "今天已经尝试过采集自愈，避免重复触发 API 限流" "manual_intervention" "blocked"
    return 1
  fi

  mark_file "$marker"
  if ! run_cmd "LEAD_REPORT_TRIGGER=0 ./run-wechat-collector-daily.sh" env LEAD_REPORT_TRIGGER=0 bash "$APP_DIR/run-wechat-collector-daily.sh" >> "$LOG_FILE" 2>&1; then
    add_event "P1" "wechat_collector_rerun_failed" "微信采集脚本重跑失败" "manual_intervention" "failed"
    return 1
  fi

  count="$(sqlite3 "$WECHAT_DB_PATH" "SELECT COUNT(*) FROM wechat_articles WHERE collected_at >= '$start' AND collected_at < '$end';" 2>/dev/null || echo 0)"
  if [[ "$count" == "0" ]]; then
    add_event "P1" "wechat_collection_still_empty" "重跑后采集窗口入库数仍为 0" "manual_intervention" "failed"
    return 1
  fi

  add_event "P2" "wechat_collection_recovered" "微信采集重跑后入库数：$count" "none" "resolved"
  FIX_APPLIED=1
  return 0
}

safe_deploy() {
  if [[ "$ENABLE_SAFE_DEPLOY" != "1" ]]; then
    add_event "P4" "deploy_skipped" "ENABLE_SAFE_DEPLOY 未开启，跳过自动部署" "manual_or_enable_safe_deploy" "blocked"
    return 0
  fi

  local age
  age="$(last_mark_age_seconds "last-safe-deploy.at")"
  if [[ "$age" -lt "$MIN_DEPLOY_INTERVAL_SECONDS" ]]; then
    add_event "P1" "deploy_cooldown" "距离上次自动部署 ${age}s，低于冷却阈值 ${MIN_DEPLOY_INTERVAL_SECONDS}s" "manual_intervention" "blocked"
    return 1
  fi

  if have_command git; then
    local status
    status="$(git -C "$APP_DIR" status --porcelain 2>/dev/null || true)"
    if [[ -n "$status" && "${AUTO_DEPLOY_ALLOW_DIRTY:-0}" != "1" ]]; then
      add_event "P1" "deploy_blocked_dirty_worktree" "工作区存在未提交改动，禁止自动部署" "manual_intervention" "blocked"
      return 1
    fi
  fi

  add_event "P3" "safe_deploy_started" "开始安全部署前测试" "npm_test_and_deploy" "fixing"
  if ! run_cmd "npm test" npm test >> "$LOG_FILE" 2>&1; then
    add_event "P1" "test_failed" "npm test 失败，禁止自动部署" "manual_intervention" "failed"
    return 1
  fi

  if ! run_cmd "npm run build" npm run build >> "$LOG_FILE" 2>&1; then
    add_event "P1" "build_failed" "npm run build 失败，禁止自动部署" "manual_intervention" "failed"
    return 1
  fi

  mark_file "last-safe-deploy.at"
  if ! run_cmd "bash deploy.sh deploy" bash "$DEPLOY_SCRIPT" deploy >> "$LOG_FILE" 2>&1; then
    add_event "P0" "deploy_failed" "deploy.sh deploy 执行失败" "manual_intervention" "failed"
    return 1
  fi

  if wait_for_health; then
    add_event "P3" "deploy_succeeded" "自动部署完成且健康检查通过" "none" "resolved"
    FIX_APPLIED=1
    return 0
  fi

  add_event "P0" "deploy_health_failed" "部署后健康检查失败，停止继续操作" "manual_intervention" "failed"
  STOP_AUTOMATION=1
  return 1
}

print_summary() {
  local text
  text="$(
    {
      echo "Jedi 自动巡检自愈结果"
      echo
      echo "运行 ID：$RUN_ID"
      echo "时间：$(date '+%Y-%m-%d %H:%M:%S')"
      echo "服务：$PM2_APP_NAME / $PUBLIC_HEALTH_URL"
      echo
      if [[ "${#EVENTS[@]}" -eq 0 ]]; then
        echo "结果：未发现需要处理的异常。"
      else
        echo "风险与处理："
        local sev event category summary action status
        for sev in P0 P1 P2 P3 P4; do
          for event in "${EVENTS[@]}"; do
            IFS='|' read -r category summary action status <<< "${event#*|}"
            if [[ "${event%%|*}" == "$sev" ]]; then
              echo "- [$sev][$status] $category：$summary；动作：$action"
            fi
          done
        done
      fi
      echo
      echo "日志：$LOG_FILE"
      echo "事件：$EVENTS_FILE"
    }
  )"

  printf '%s\n' "$text" | tee -a "$LOG_FILE"

  if [[ "${#EVENTS[@]}" -gt 0 || "${ALWAYS_NOTIFY:-0}" == "1" ]]; then
    send_notification "$text"
  fi
}

acquire_lock() {
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    printf '%s\n' "$$" > "$LOCK_DIR/pid"
    return 0
  fi

  local existing_pid age lock_mtime now
  existing_pid="$(cat "$LOCK_DIR/pid" 2>/dev/null || true)"
  if [[ -n "$existing_pid" ]] && kill -0 "$existing_pid" 2>/dev/null; then
    log "另一个自愈流程正在运行，pid=$existing_pid，本次退出。"
    exit 0
  fi

  now="$(date '+%s')"
  lock_mtime="$(date -r "$LOCK_DIR" '+%s' 2>/dev/null || echo 0)"
  age="$((now - lock_mtime))"
  if [[ "$age" -gt 7200 ]]; then
    log "发现陈旧锁，age=${age}s，清理后继续。"
    rm -rf "$LOCK_DIR"
    mkdir "$LOCK_DIR"
    printf '%s\n' "$$" > "$LOCK_DIR/pid"
    return 0
  fi

  log "锁目录存在且未过期：$LOCK_DIR，本次退出。"
  exit 0
}

cleanup() {
  rm -rf "$LOCK_DIR" 2>/dev/null || true
}

usage() {
  cat <<EOF
Usage: bash scripts/auto-remediation.sh {run|install-cron|print-cron}

Commands:
  run          Run one auto-remediation cycle. This is what cron should execute.
  install-cron Install or update the cron entry for this script.
  print-cron   Print the cron entry without installing it.

Common environment variables:
  AUTO_FIX=1                         Enable low-risk auto fixes. Default: 1
  ENABLE_SAFE_DEPLOY=0               Enable tested deploy after fixes. Default: 0
  ENABLE_WECHAT_COLLECTOR_FIX=0      Enable one-shot collector rerun. Default: 0
  FEISHU_BOT_WEBHOOK=...             Optional Feishu bot webhook for notifications
  NOTIFY_WEBHOOK_URL=...             Optional generic JSON webhook: {"text":"..."}
  AUTO_REMEDIATION_NOTIFY_CMD=...    Optional trusted local notify command

Recommended cron:
  AUTO_FIX=1 ENABLE_SAFE_DEPLOY=0 bash $APP_DIR/scripts/auto-remediation.sh run
EOF
}

cron_entry() {
  local schedule command
  schedule="${AUTO_REMEDIATION_CRON_SCHEDULE:-*/10 * * * *}"
  command="cd $APP_DIR && AUTO_FIX=${AUTO_FIX:-1} ENABLE_SAFE_DEPLOY=${ENABLE_SAFE_DEPLOY:-0} ENABLE_WECHAT_COLLECTOR_FIX=${ENABLE_WECHAT_COLLECTOR_FIX:-0} bash $APP_DIR/scripts/auto-remediation.sh run >> $STATE_DIR/cron.log 2>&1 # jedi-auto-remediation"
  printf '%s %s\n' "$schedule" "$command"
}

print_cron() {
  mkdir -p "$STATE_DIR"
  cron_entry
}

install_cron() {
  if ! have_command crontab; then
    echo "crontab command not found"
    exit 1
  fi

  mkdir -p "$STATE_DIR"
  local tmp_cron
  tmp_cron="$(mktemp)"
  trap 'rm -f "$tmp_cron"' RETURN

  crontab -l 2>/dev/null | grep -v '# jedi-auto-remediation' > "$tmp_cron" || true
  cron_entry >> "$tmp_cron"
  crontab "$tmp_cron"

  echo "已安装 Jedi 自动巡检自愈定时任务："
  cron_entry
  echo
  echo "查看日志："
  echo "tail -f $STATE_DIR/cron.log"
}

main() {
  acquire_lock
  trap cleanup EXIT

  cd "$APP_DIR" || exit 1
  log "===== auto-remediation started: $RUN_ID ====="

  if [[ ! -f "$DEPLOY_SCRIPT" ]]; then
    add_event "P1" "deploy_script_missing" "部署脚本不存在：$DEPLOY_SCRIPT" "manual_intervention" "failed"
    STOP_AUTOMATION=1
  fi

  if [[ "$STOP_AUTOMATION" != "1" && ! -f "$DIST_ENTRY" ]]; then
    if [[ "$AUTO_FIX" == "1" ]]; then
      fix_missing_dist || EXIT_CODE=1
    else
      add_event "P3" "dist_missing" "前端 dist 缺失" "enable_auto_fix_or_manual_build" "detected"
    fi
  fi

  if [[ "$STOP_AUTOMATION" != "1" ]]; then
    if health_ok; then
      log "health ok"
    else
      add_event "P0" "health_failed" "服务健康检查失败：$PUBLIC_HEALTH_URL" "safe_restart_service" "detected"
      if [[ "$AUTO_FIX" == "1" ]]; then
        safe_restart_service || EXIT_CODE=1
      else
        STOP_AUTOMATION=1
      fi
    fi
  fi

  if [[ "$STOP_AUTOMATION" != "1" ]]; then
    check_daily_report || EXIT_CODE=1
  fi

  if [[ "$STOP_AUTOMATION" != "1" ]]; then
    check_wechat_collector || EXIT_CODE=1
  fi

  if [[ "$STOP_AUTOMATION" != "1" && "$DEPLOY_REQUIRED" == "1" ]]; then
    safe_deploy || EXIT_CODE=1
  fi

  if [[ "$STOP_AUTOMATION" == "1" ]]; then
    EXIT_CODE=1
  fi

  print_summary
  log "===== auto-remediation finished: $RUN_ID exit=$EXIT_CODE ====="
  exit "$EXIT_CODE"
}

case "${1:-run}" in
  run)
    main
    ;;
  install-cron)
    install_cron
    ;;
  print-cron)
    print_cron
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    usage
    exit 1
    ;;
esac
