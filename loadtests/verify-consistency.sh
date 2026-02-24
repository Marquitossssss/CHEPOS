#!/usr/bin/env sh
set -e

if [ -z "$DATABASE_URL" ]; then
  echo "DATABASE_URL no definido"
  exit 1
fi

EVENT_ID_VALUE="${EVENT_ID:-}"
TICKET_TYPE_ID_VALUE="${TICKET_TYPE_ID:-}"

if [ -z "$EVENT_ID_VALUE" ] && [ -z "$TICKET_TYPE_ID_VALUE" ]; then
  echo "Definí EVENT_ID o TICKET_TYPE_ID para scope del test"
  exit 1
fi

psql "$DATABASE_URL" \
  -v EVENT_ID="$EVENT_ID_VALUE" \
  -v TICKET_TYPE_ID="$TICKET_TYPE_ID_VALUE" \
  -f loadtests/verify-no-oversell.sql

psql "$DATABASE_URL" \
  -v EVENT_ID="$EVENT_ID_VALUE" \
  -v TICKET_TYPE_ID="$TICKET_TYPE_ID_VALUE" \
  -f loadtests/verify-ticket-issuance-consistency.sql

psql "$DATABASE_URL" \
  -v EVENT_ID="$EVENT_ID_VALUE" \
  -v TICKET_TYPE_ID="$TICKET_TYPE_ID_VALUE" \
  -f loadtests/verify-expired-reservations.sql
