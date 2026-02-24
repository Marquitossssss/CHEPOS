# RUNBOOK: redis caído

1. Validar estado:
```bash
docker compose ps redis
```
2. Probar ping:
```bash
docker compose exec redis redis-cli ping
```
3. Recuperación:
```bash
docker compose restart redis
docker compose restart api worker
```
