#!/usr/bin/env bash
# Обёртка ngrok для pm2 (app 'tunnel'). Владеет туннелем :8787 → публичный URL
# и пишет его в state, чтобы register.sh/register-fallbacks могли переиспользовать
# (свой ngrok НЕ поднимаем — он один, живёт под pm2).
set -euo pipefail

PORT="${PORT:-8787}"
STATE_FILE="${TRELLO_WEBHOOK_STATE:-$HOME/.local/state/opencode-workflow/trello-webhook.json}"

exec ngrok http "$PORT" --log=stdout
