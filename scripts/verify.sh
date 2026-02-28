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
  echo "[verify] No se encontró EVENT_ID. Ejecutando seed para poblar datos mínimos..."
  docker compose run --rm seed >/dev/null
  EVENT_ID="$(docker compose exec -T postgres psql -U "${POSTGRES_USER:-articket}" -d "${POSTGRES_DB:-articket}" -t -A -c 'SELECT id::text FROM "Event" ORDER BY "createdAt" DESC LIMIT 1;' | tr -d '\r')"
fi

if [[ -z "$EVENT_ID" ]]; then
  echo "[verify] No se pudo obtener EVENT_ID ni luego de seed" >&2
  exit 1
fi

echo "[verify] Verificando consistencia SQL para EVENT_ID=$EVENT_ID"
docker compose exec -T postgres psql -U "${POSTGRES_USER:-articket}" -d "${POSTGRES_DB:-articket}" -v EVENT_ID="$EVENT_ID" -v TICKET_TYPE_ID='' < loadtests/verify-no-oversell.sql
docker compose exec -T postgres psql -U "${POSTGRES_USER:-articket}" -d "${POSTGRES_DB:-articket}" -v EVENT_ID="$EVENT_ID" -v TICKET_TYPE_ID='' < loadtests/verify-ticket-issuance-consistency.sql
docker compose exec -T postgres psql -U "${POSTGRES_USER:-articket}" -d "${POSTGRES_DB:-articket}" -v EVENT_ID="$EVENT_ID" -v TICKET_TYPE_ID='' < loadtests/verify-expired-reservations.sql

echo "[verify] OK"