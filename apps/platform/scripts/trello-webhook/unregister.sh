#!/usr/bin/env bash
# Отмена Trello webhook: удаляет webhook у Trello и binding в платформе.
# ngrok-процесс (дев-схема) гасится только если pid есть в state; в проде
# туннеля нет, а в дев-схеме им владеет pm2 — блок почти всегда пустой.
# Использование: ./unregister.sh
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$DIR/../../../.env"
STATE_DIR="${STATE_DIR:-$HOME/.local/state/opencode-workflow}"
STATE_FILE="$STATE_DIR/trello-webhook.json"

if [ -f "$ENV_FILE" ]; then
  while IFS='=' read -r k v; do
    if [ -n "$k" ] && [ -z "${!k:-}" ]; then export "$k=$v"; fi
  done < <(grep -E '^[A-Z_]+=' "$ENV_FILE")
fi
: "${TRELLO_API_KEY:?требуется TRELLO_API_KEY (env или apps/platform/.env)}"
: "${TRELLO_TOKEN:?требуется TRELLO_TOKEN (env или apps/platform/.env)}"
PORT="${PORT:-8787}"
BASE="http://127.0.0.1:$PORT"

if [ ! -f "$STATE_FILE" ]; then
  echo "Нет состояния ($STATE_FILE) — нечего отменять." >&2
  exit 0
fi

json_get() { python3 -c 'import json,sys
try:
  print(json.load(sys.stdin).get(sys.argv[1], ""))
except Exception:
  print("")' "$1"; }

STATE_JSON="$(cat "$STATE_FILE")"

WEBHOOK_ID="$(<<<"$STATE_JSON" json_get trelloWebhookId)"
if [ -n "$WEBHOOK_ID" ]; then
  curl -s -o /dev/null -X DELETE "https://api.trello.com/1/webhooks/$WEBHOOK_ID?key=$TRELLO_API_KEY&token=$TRELLO_TOKEN"
  echo "[ok] trello webhook $WEBHOOK_ID удалён"
fi

BINDING_ID="$(<<<"$STATE_JSON" json_get bindingId)"
if [ -n "$BINDING_ID" ]; then
  curl -s -o /dev/null -X DELETE "$BASE/hooks/$BINDING_ID"
  echo "[ok] binding $BINDING_ID удалён"
fi

NGROK_PID="$(<<<"$STATE_JSON" json_get ngrokPid)"
if [ -n "$NGROK_PID" ] && kill -0 "$NGROK_PID" 2>/dev/null; then
  kill "$NGROK_PID" && echo "[ok] ngrok pid=$NGROK_PID остановлен"
fi

rm -f "$STATE_FILE"
echo "[done] Trello-webhook отключён"