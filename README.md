# Articket Platform

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
```

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
