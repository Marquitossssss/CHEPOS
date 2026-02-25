# Runbook: cola de emails creciendo

## Síntoma
- La cola `notifications` crece de forma sostenida.

## Verificación rápida
1. Revisar logs del worker:
   ```bash
   docker compose logs -f worker
   ```
2. Validar conectividad Redis y DB.
3. Confirmar credenciales SendGrid (`SENDGRID_API_KEY`, template).

## Mitigación
- Reiniciar worker:
  ```bash
  docker compose restart worker
  ```
- Reducir ritmo de reintentos temporalmente.
- Reprocesar jobs fallidos una vez corregido el origen.

## Postmortem
- Registrar tasa de errores, causa raíz y tiempo de recuperación.
