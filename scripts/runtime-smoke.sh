#!/usr/bin/env bash
set -euo pipefail

on_fail_dump() {
  echo "[smoke][debug] docker compose ps"
  docker compose ps || true
  echo "[smoke][debug] docker compose logs api"
  docker compose logs --no-color api || true
  echo "[smoke][debug] docker compose logs worker"
  docker compose logs --no-color worker || true
  echo "[smoke][debug] docker compose port api 3000"
  docker compose port api 3000 || true
  echo "[smoke][debug] docker compose port worker 9101"
  docker compose port worker 9101 || true
}
trap on_fail_dump ERR

retry_curl() {
  local url="$1"
  local attempts="${2:-20}"
  local sleep_seconds="${3:-3}"

  for i in $(seq 1 "$attempts"); do
    if curl -sSf --max-time 5 "$url" >/dev/null; then
      return 0
    fi
    echo "[smoke] waiting for $url (attempt $i/$attempts)"
    sleep "$sleep_seconds"
  done

  echo "[smoke] FAIL: $url did not respond after $attempts attempts" >&2
  return 1
}

echo "[smoke] 1) docker compose down -v"
docker compose down -v

echo "[smoke] 2) docker compose build --no-cache"
docker compose build --no-cache

echo "[smoke] 3) docker compose up -d"
docker compose up -d

echo "[smoke] 4) API health"
retry_curl "http://localhost:3000/health"

echo "[smoke] 5) API metrics"
retry_curl "http://localhost:3000/metrics"

echo "[smoke] 6) Worker health"
retry_curl "http://localhost:9101/health"

echo "[smoke] 7) Worker metrics"
retry_curl "http://localhost:9101/metrics"

echo "[smoke] 8) Logs api/worker"
docker compose logs --tail=200 api worker

echo "[smoke] 9) Anti-symlink Windows"
ANTI_SYMLINK_OUTPUT="$(docker compose exec -T api sh -lc "grep -R 'C:/' -n /app 2>/dev/null | head -n 20 || true")"
if [ -n "$ANTI_SYMLINK_OUTPUT" ]; then
  echo "$ANTI_SYMLINK_OUTPUT"
  echo "[smoke] FAIL: se detectaron rutas Windows (C:/) dentro de la imagen" >&2
  exit 1
fi

echo "OK"
