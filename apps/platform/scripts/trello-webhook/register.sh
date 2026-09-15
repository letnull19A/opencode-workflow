#!/usr/bin/env bash
# Регистрация Trello webhook на локальную платформу через ngrok-туннель.
# Env: TRELLO_API_KEY, TRELLO_TOKEN, TRELLO_BOARD (+ PORT, PUBLIC_URL, WORKFLOWS_DIR).
# Создаёт binding provider=trello, регистрирует webhook updateCard/createCard
# у Trello и сохраняет состояние в $STATE_DIR/trello-webhook.json.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$DIR/../../../.." && pwd)"
ENV_FILE="$REPO_ROOT/apps/platform/.env"

# Подхватываем Trello-переменные из apps/platform/.env, не перетирая внешние.
if [ -f "$ENV_FILE" ]; then
  while IFS='=' read -r k v; do
    case "$k" in
      TRELLO_API_KEY|TRELLO_TOKEN|TRELLO_BOARD|PORT|PUBLIC_URL|WORKFLOWS_DIR)
        if [ -z "${!k:-}" ]; then export "$k=$v"; fi ;;
    esac
  done < <(grep -E '^(TRELLO_API_KEY|TRELLO_TOKEN|TRELLO_BOARD|PORT|PUBLIC_URL|WORKFLOWS_DIR)=' "$ENV_FILE")
fi

: "${TRELLO_API_KEY:?нужен TRELLO_API_KEY (env или apps/platform/.env)}"
: "${TRELLO_TOKEN:?нужен TRELLO_TOKEN (env или apps/platform/.env)}"
: "${TRELLO_BOARD:?нужен TRELLO_BOARD (env или apps/platform/.env)}"
PORT="${PORT:-8787}"
BASE="http://127.0.0.1:$PORT"
STATE_DIR="${STATE_DIR:-$HOME/.local/state/opencode-workflow}"
STATE_FILE="$STATE_DIR/trello-webhook.json"
mkdir -p "$STATE_DIR"

json_get() { python3 -c 'import json,sys
try: print(json.load(sys.stdin).get(sys.argv[1], ""))
except Exception: print("")' "$1"; }
read_state() { [ -f "$STATE_FILE" ] || return 0; BINDING_ID="$(json_get bindingId < "$STATE_FILE")"; PUBLIC_URL="$(json_get publicUrl < "$STATE_FILE")"; NGROK_PID="$(json_get ngrokPid < "$STATE_FILE")"; TRELLO_WEBHOOK_ID="$(json_get trelloWebhookId < "$STATE_FILE")"; }

# ── 1. Платформа жива? ────────────────────────────────────────────────
curl -sf "$BASE/health" >/dev/null || { echo "Платформа не запущена ($BASE). Сначала: cd apps/platform && pnpm dev" >&2; exit 1; }
echo "[1] платформа: $BASE"

# ── 2. id доски по имени ──────────────────────────────────────────────
BOARDS_JSON="$(curl -sf "https://api.trello.com/1/members/me/boards?key=$TRELLO_API_KEY&token=$TRELLO_TOKEN")"
BOARD_ID="$(<<<"$BOARDS_JSON" python3 -c '
import json, sys
for b in json.load(sys.stdin):
    if b.get("name") == sys.argv[1]:
        print(b["id"]); break
' "$TRELLO_BOARD")"
[ -n "$BOARD_ID" ] || { echo "Доска '$TRELLO_BOARD' не найдена." >&2; exit 1; }
echo "[2] доска '$TRELLO_BOARD' = $BOARD_ID"

# ── 3. Публичный URL (переиспользуем живой туннель из state) ─────────
read_state
TUNNEL_OK=""
TUNNEL_OK=""
# Туннелем владеет pm2 (app 'tunnel' в ecosystem.config.cjs). Свой ngrok НЕ поднимаем —
# берём живой public_url из его API :4040 и сохраняем в state (идемпотентность).
if [ -n "${PUBLIC_URL:-}" ] && curl -sf "${PUBLIC_URL%/}/health" >/dev/null 2>&1; then
  TUNNEL_OK="yes"
  echo "[3] туннель жив: $PUBLIC_URL"
fi
if [ -z "$TUNNEL_OK" ]; then
  PUBLIC_URL="$(curl -sf http://127.0.0.1:4040/api/tunnels 2>/dev/null \
    | python3 -c 'import json,sys
try:
  d=json.load(sys.stdin)
  print(d["tunnels"][0]["public_url"] if d.get("tunnels") else "")
except Exception: print("")' || true)"
  if [ -n "$PUBLIC_URL" ] && curl -sf "${PUBLIC_URL%/}/health" >/dev/null 2>&1; then
    TUNNEL_OK="yes"
    echo "[3] туннель pm2 жив: $PUBLIC_URL"
  else
    echo "Туннеля нет. Запусти сначала: cd apps/platform && pm2 start ecosystem.config.cjs && pm2 save — затем повтори этот скрипт." >&2
    exit 1
  fi
fi

CALLBACK_URL="${PUBLIC_URL:-${PUBLIC_URL:-}}/hooks"
echo "[4] callback: $CALLBACK_URL"

# ── 5. Binding provider=trello (переиспользуем существующий) ──────────
if [ -n "${BINDING_ID:-}" ] && curl -sf "$BASE/hooks" 2>/dev/null | grep -q "\"id\":\"$BINDING_ID\""; then
  echo "[5] binding переиспользуем: $BINDING_ID"
else
  BINDING_JSON="$(curl -s -X POST "$BASE/hooks" -H 'content-type: application/json' -d '{"provider":"trello","source":"trello","enabled":true}')"
  BINDING_ID="$(<<<"$BINDING_JSON" python3 -c 'import json,sys
try: print(json.load(sys.stdin)["id"])
except Exception: print("")')"
  [ -n "$BINDING_ID" ] || { echo "Binding не создан: $BINDING_JSON" >&2; exit 1; }
  echo "[5] binding создан: $BINDING_ID"
fi
CALLBACK_URL="$CALLBACK_URL/$BINDING_ID"
echo "   callback webhook: $CALLBACK_URL"

# ── 6. Webhook в Trello на доску (переиспользуем из state) ───────────
if [ -n "${TRELLO_WEBHOOK_ID:-}" ]; then
  echo "[6] webhook переиспользуем: $TRELLO_WEBHOOK_ID"
else
  WH_JSON="$(curl -s -X POST "https://api.trello.com/1/webhooks?key=$TRELLO_API_KEY&token=$TRELLO_TOKEN" \
    --data-urlencode "callbackURL=$CALLBACK_URL" \
    --data-urlencode "idModel=$BOARD_ID" \
    --data-urlencode "description=opencode-workflow")"
  TRELLO_WEBHOOK_ID="$(<<<"$WH_JSON" python3 -c 'import json,sys
try: print(json.load(sys.stdin)["id"])
except Exception: print("")')"
  [ -n "$TRELLO_WEBHOOK_ID" ] || { echo "Webhook Trello не создан: $WH_JSON" >&2; exit 1; }
  echo "[6] webhook создан: $TRELLO_WEBHOOK_ID"
fi

write_state() {
  cat > "$STATE_FILE" <<EOF
{
  "bindingId": "$BINDING_ID",
  "publicUrl": "$PUBLIC_URL",
  "callbackUrl": "$CALLBACK_URL",
  "ngrokPid": "$NGROK_PID",
  "trelloWebhookId": "$TRELLO_WEBHOOK_ID",
  "registeredAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
}
write_state

echo "[7] готово. Webhook Trello:"
echo "    publicUrl : $PUBLIC_URL"
echo "    callback  : $CALLBACK_URL  (платформа издаёт task.moved/task.received)"