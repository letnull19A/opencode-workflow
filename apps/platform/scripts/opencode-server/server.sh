#!/usr/bin/env bash
# pm2-app opencode: headless opencode server для демо (только локально).
# Прод: сервер удалённый, платформа цепляется по OPENCODE_SERVER_URL.
set -euo pipefail
PORT="${OPENCODE_PORT:-4096}"
exec opencode serve --hostname 127.0.0.1 --port "$PORT"
