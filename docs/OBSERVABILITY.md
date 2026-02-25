# Observabilidad mínima

## Logs
- API usa logger estructurado de Fastify.
- Para inspección local:
```bash
docker compose logs -f api
docker compose logs -f worker
```

## Correlation y trazabilidad
- DomainEvent incluye `correlationId`, `actorType/actorId`, `aggregateType/aggregateId`.
- La pantalla de actividad del evento muestra estos campos para auditoría.

## Salud de servicios
```bash
docker compose ps
docker compose logs --tail=200 postgres redis api worker
```
