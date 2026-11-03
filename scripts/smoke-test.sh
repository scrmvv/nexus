#!/usr/bin/env bash
set -euo pipefail
PORT="${1:-4317}"
curl -fsS "http://127.0.0.1:${PORT}/api/state" | python3 -m json.tool | head -60
printf '\n[OK] Main page: '
curl -s -o /dev/null -w '%{http_code}\n' "http://127.0.0.1:${PORT}/"
printf '[OK] SSE: '
curl -sN --max-time 2 "http://127.0.0.1:${PORT}/api/stream" | head -c 120 || true
printf '\n'
