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

## Metrics Prometheus
- API: `GET /metrics` en puerto `3000` (usa `METRICS_TOKEN` opcional por header `x-metrics-token`).
- Worker: `GET /metrics` en puerto `9101` (mismo token opcional).

Métricas principales:
- API: `http_requests_total`, `http_request_duration_seconds`, `http_in_flight_requests`, `domain_events_total`, `domain_events_errors_total`.
- Worker: `bullmq_jobs_total`, `bullmq_job_duration_seconds`.

## Correlation ID
- La API acepta `x-correlation-id`; si no llega usa `req.id`.
- El correlationId viaja en `job.data.meta.correlationId` hacia BullMQ.
- El worker lo registra en logs (`failed/completed`) y lo usa al emitir `DomainEvent`.
