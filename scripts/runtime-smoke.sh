#!/usr/bin/env bash
set -euo pipefail

echo "[smoke] 1) docker compose down -v"
docker compose down -v

echo "[smoke] 2) docker compose build --no-cache"
docker compose build --no-cache

echo "[smoke] 3) docker compose up -d"
docker compose up -d

echo "[smoke] 4) API health"
curl -sSf http://localhost:3000/health

echo "[smoke] 5) API metrics"
curl -sSf http://localhost:3000/metrics >/dev/null

echo "[smoke] 6) Worker health"
curl -sSf http://localhost:9101/health

echo "[smoke] 7) Worker metrics"
curl -sSf http://localhost:9101/metrics >/dev/null

echo "[smoke] 8) Logs api/worker"
docker compose logs --tail=200 api worker

echo "[smoke] 9) Anti-symlink Windows"
ANTI_SYMLINK_OUTPUT="$(docker run --rm articket-api sh -lc "grep -R 'C:/' -n /app 2>/dev/null | head -n 20 || true")"
if [ -n "$ANTI_SYMLINK_OUTPUT" ]; then
  echo "$ANTI_SYMLINK_OUTPUT"
  echo "[smoke] FAIL: se detectaron rutas Windows (C:/) dentro de la imagen" >&2
  exit 1
fi

echo "OK"
