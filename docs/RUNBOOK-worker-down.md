# RUNBOOK: worker caído

1. Validar estado:
```bash
docker compose ps worker
```
2. Revisar logs:
```bash
docker compose logs --tail=200 worker
```
3. Levantar/reiniciar worker:
```bash
docker compose up -d worker
```
