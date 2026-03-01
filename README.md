#  Platform

![CI](https://github.com/<owner>/articket-platform/actions/workflows/ci.yml/badge.svg)
![Coverage](https://img.shields.io/badge/coverage-pending-lightgrey)
![Issues](https://img.shields.io/github/issues/<owner>/articket-platform)

Monorepo **TypeScript** para ticketing multi-organizador, listo para repo **privado** en GitHub (`articket-platform`).

## Estructura
- `apps/web` → React + Vite
- `apps/api` → Fastify + Prisma
- `packages/shared` → tipos/schemas compartidos
- `loadtests` → k6 + SQL checks
- `scripts` → scripts operativos
- `docs` → setup, API, observabilidad, runbooks
- `tests` → integración/contract tests
- `.github/workflows` → CI

## Comandos oficiales
```bash
./scripts/start.sh
./scripts/test.sh
./scripts/verify.sh
./scripts/lint.sh
./scripts/runtime-smoke.sh
```


## Runtime: desarrollo vs producción
- **Desarrollo local**: podés usar `pnpm dev` fuera de Docker para iterar rápido.
- **Producción en Docker (recomendado)**:
  - la imagen API/Worker compila TypeScript en stage `builder` (`tsc`),
  - runtime ejecuta **solo Node** (`node dist/server.js` y `node dist/workers/notificationsWorker.js`),
  - sin `tsx watch`,
  - sin `pnpm` en ejecución,
  - con `node_modules` de producción (via `pnpm deploy --prod`).

### Arranque reproducible (prod-like)
```bash
cp .env.example .env
./scripts/start.sh
```

Esto ejecuta:
- API en `node dist/server.js`
- Worker en `node dist/workers/notificationsWorker.js`
- `pnpm exec prisma migrate deploy` al boot
- seed **solo opt-in** (`SEED_ON_START=true`)
- healthchecks Compose para postgres/redis/api/worker

## Setup rápido
```bash
cp .env.example .env
./scripts/start.sh
```

Más detalle en `docs/SETUP.md`.

## Actividad del evento
Ruta frontend:
- `/dashboard/events/:eventId/activity`

Incluye:
- cursor pagination (`occurredAt DESC, id DESC`)
- filtros por `types`
- visualización de `correlationId`, actor y summary server-side


## Métricas
- API: `GET /metrics` (`http_requests_total`, `http_request_duration_seconds`, `http_in_flight_requests`, `domain_events_total`).
- Worker: `GET /metrics` en `:9101` (`bullmq_jobs_total`, `bullmq_job_duration_seconds`).
- Si definís `METRICS_TOKEN`, enviar header `x-metrics-token` en ambos endpoints.

## Loadtests y consistencia
Ver:
- `loadtests/*.js`
- `loadtests/*.sql`
- `./scripts/verify.sh`

## Documentación
- Setup: `docs/SETUP.md`
- API: `docs/API.md`
- Observabilidad: `docs/OBSERVABILITY.md`
- Runbooks:
  - `docs/RUNBOOK-email-queue.md`
  - `docs/RUNBOOK-worker-down.md`
  - `docs/RUNBOOK-redis-down.md`

## Seguridad
- No subir `.env` ni secretos.
- Usar `.env.example` como plantilla.
- Rotar claves periódicamente (`JWT_*`, `QR_SECRET`, `SENDGRID_*`).

## CI
Workflow: `.github/workflows/ci.yml`.
- ubuntu-latest
- Node 18 pinneado
- servicios: postgres + redis
- ejecución: `./scripts/test.sh` y `./scripts/verify.sh`


## Diagnóstico rápido (stabilización + observabilidad)
En una máquina limpia:
```bash
docker compose down -v
docker compose build --no-cache
docker compose up -d
curl -sSf http://localhost:3000/health
curl -sSf http://localhost:3000/metrics >/dev/null
curl -sSf http://localhost:9101/health
curl -sSf http://localhost:9101/metrics >/dev/null
docker compose logs --tail=200 api worker

# anti-symlink host (debe terminar sin resultados)
docker run --rm articket-api sh -lc "grep -R 'C:/' -n /app 2>/dev/null | head -n 20 || echo OK"
```

También podés correr todo junto:
```bash
./scripts/runtime-smoke.sh
```
