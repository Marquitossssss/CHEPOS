#!/usr/bin/env bash
set -euo pipefail

echo "[verify] Ejecutando tests reproducibles..."
./scripts/test.sh

echo "[verify] Levantando servicios mínimos para verificaciones SQL..."
docker compose up -d postgres redis api >/dev/null

EVENT_ID="${EVENT_ID:-}"
if [[ -z "$EVENT_ID" ]]; then
  EVENT_ID="$(docker compose exec -T postgres psql -U "${POSTGRES_USER:-articket}" -d "${POSTGRES_DB:-articket}" -t -A -c 'SELECT id::text FROM "Event" ORDER BY "createdAt" DESC LIMIT 1;' | tr -d '\r')"
fi

if [[ -z "$EVENT_ID" ]]; then
  echo "[verify] No se encontró EVENT_ID para verificar consistencia" >&2
  exit 1
fi

POSTGRES_HOST_COMPOSE="${POSTGRES_HOST:-postgres}"
POSTGRES_PORT_COMPOSE="${POSTGRES_PORT:-5432}"
POSTGRES_DB_COMPOSE="${POSTGRES_DB:-articket}"
POSTGRES_USER_COMPOSE="${POSTGRES_USER:-articket}"
POSTGRES_PASSWORD_COMPOSE="${POSTGRES_PASSWORD:?POSTGRES_PASSWORD required}"
DB_URL="postgresql://${POSTGRES_USER_COMPOSE}:${POSTGRES_PASSWORD_COMPOSE}@${POSTGRES_HOST_COMPOSE}:${POSTGRES_PORT_COMPOSE}/${POSTGRES_DB_COMPOSE}?schema=public"

echo "[verify] Verificando consistencia SQL para EVENT_ID=$EVENT_ID"
docker compose run --rm api sh -lc "psql '$DB_URL' -v EVENT_ID='$EVENT_ID' -v TICKET_TYPE_ID='' -f /app/loadtests/verify-no-oversell.sql"
docker compose run --rm api sh -lc "psql '$DB_URL' -v EVENT_ID='$EVENT_ID' -v TICKET_TYPE_ID='' -f /app/loadtests/verify-ticket-issuance-consistency.sql"
docker compose run --rm api sh -lc "psql '$DB_URL' -v EVENT_ID='$EVENT_ID' -v TICKET_TYPE_ID='' -f /app/loadtests/verify-expired-reservations.sql"

echo "[verify] OK"
