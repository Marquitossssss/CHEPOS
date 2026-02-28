# Runbook: redis caído

## Síntoma
- Falla encolado BullMQ o workers sin conexión.

## Diagnóstico
1. Estado del contenedor Redis:
   ```bash
   docker compose ps redis
   ```
2. Prueba básica de ping:
   ```bash
   docker compose exec redis redis-cli ping
   ```

## Recuperación
- Reiniciar Redis:
  ```bash
  docker compose restart redis
  ```
- Reiniciar API y worker para reconectar:
  ```bash
  docker compose restart api worker
  ```

## Riesgos
- Jobs en memoria no persistida pueden requerir reintento manual.
