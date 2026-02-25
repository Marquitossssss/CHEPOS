#!/bin/sh
set -eu

MODE="${1:-api}"

require_var() {
  name="$1"
  value="${2:-}"
  if [ -z "$value" ]; then
    echo "[entrypoint] $name is required" >&2
    exit 1
  fi
}

require_secret_len() {
  name="$1"
  value="$2"
  min_len="$3"
  if [ "${#value}" -lt "$min_len" ]; then
    echo "[entrypoint] $name must be at least $min_len characters" >&2
    exit 1
  fi
}

POSTGRES_HOST="${POSTGRES_HOST:-postgres}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
POSTGRES_DB="${POSTGRES_DB:-articket}"
POSTGRES_USER="${POSTGRES_USER:-articket}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-}"

require_var "POSTGRES_PASSWORD" "$POSTGRES_PASSWORD"

if [ -z "${DATABASE_URL:-}" ]; then
  export DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}?schema=public"
fi

JWT_ACCESS_SECRET="${JWT_ACCESS_SECRET:-}"
JWT_REFRESH_SECRET="${JWT_REFRESH_SECRET:-}"
QR_SECRET="${QR_SECRET:-}"

require_var "JWT_ACCESS_SECRET" "$JWT_ACCESS_SECRET"
require_var "JWT_REFRESH_SECRET" "$JWT_REFRESH_SECRET"
require_var "QR_SECRET" "$QR_SECRET"

require_secret_len "JWT_ACCESS_SECRET" "$JWT_ACCESS_SECRET" 24
require_secret_len "JWT_REFRESH_SECRET" "$JWT_REFRESH_SECRET" 24
require_secret_len "QR_SECRET" "$QR_SECRET" 24

until node -e "const net=require('net');const s=net.connect(${POSTGRES_PORT},'${POSTGRES_HOST}',()=>{s.end();process.exit(0)});s.on('error',()=>process.exit(1));"; do
  echo "Esperando postgres..."
  sleep 2
done

pnpm prisma generate

case "$MODE" in
  api)
    pnpm prisma migrate deploy
    pnpm db:seed || true
    pnpm dev
    ;;
  worker)
    pnpm worker:notifications
    ;;
  test)
    pnpm test
    ;;
  *)
    echo "[entrypoint] Modo inválido: $MODE" >&2
    exit 1
    ;;
esac
