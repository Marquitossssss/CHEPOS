# RUNBOOK: cola de emails creciendo

1. Revisar logs de worker:
```bash
docker compose logs -f worker
```
2. Validar Redis y credenciales SendGrid.
3. Reiniciar worker:
```bash
docker compose restart worker
```
