# Runbook: worker caído

## Síntoma
- No se envían emails de confirmación.

## Diagnóstico
1. Estado del servicio:
   ```bash
   docker compose ps worker
   ```
2. Logs:
   ```bash
   docker compose logs --tail=200 worker
   ```

## Recuperación
- Levantar worker:
  ```bash
  docker compose up -d worker
  ```
- Verificar cola pendiente y eventos `ORDER_CONFIRMATION_EMAIL_SENT`.

## Prevención
- Alertar si worker no reporta heartbeats.
