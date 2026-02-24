# Articket

Articket es una plataforma de ticketing multi-organizador diseñada para alto volumen de ventas, inspirada en la lógica de Attendize y pretix (a nivel conceptual), pero implementada desde cero con arquitectura modular y foco en operaciones reales. La solución se organiza como monorepo con `apps/web` (frontend React), `apps/api` (backend Fastify + TypeScript) y `packages/shared` (tipos/validaciones compartidas), para mantener consistencia entre contratos de API, reglas de negocio y experiencia de usuario.

En backend se adoptó una arquitectura por dominios (`auth`, `organizers`, `events`, `inventory`, `checkout`, `tickets`, `checkin`, `reporting`) con PostgreSQL como fuente de verdad y Redis/BullMQ para tareas asíncronas (como liberación de reservas expiradas). Esta estrategia permite robustez transaccional para evitar sobreventa, idempotencia en puntos críticos y una evolución clara hacia despliegues en VPS/Kubernetes sin reescrituras profundas.

El frontend prioriza un MVP usable y extensible: autenticación, dashboard de organizador, gestión de eventos/tipos de ticket, checkout y check-in. Se acompaña con observabilidad base (logs estructurados, healthcheck), ADRs para decisiones clave (multi-tenant, auth, stock, QR), pruebas automatizadas y scripts de carga con k6 para validar el comportamiento bajo concurrencia.

## Stack
- Frontend: React + TypeScript + Vite + React Router + TanStack Query.
- Backend: Node.js + TypeScript + Fastify + Prisma.
- Base de datos: PostgreSQL.
- Cache/colas: Redis + BullMQ.
- Infra local: Docker Compose.
- Observabilidad: pino logs, health checks.

## Estructura
- `apps/web`: aplicación React.
- `apps/api`: API REST, lógica de negocio y acceso a datos.
- `packages/shared`: tipos y schemas Zod compartidos.
- `docs/adr`: decisiones arquitectónicas.
- `loadtests`: pruebas de carga (k6).

## Setup local
1. Copiar variables:
   ```bash
   cp .env.example .env
   ```
2. Levantar stack (incluye migraciones + seed automáticos en contenedor API):
   ```bash
   docker compose up --build
   ```

## Variables de entorno
Ver `.env.example` para todos los valores requeridos.

## Scripts útiles
- `pnpm dev`: corre api + web en modo desarrollo.
- `pnpm test`: ejecuta tests de workspaces (api/web/shared).
- `pnpm lint`: lint de workspaces.
- `pnpm --filter @articket/api reservation:cleaner`: ejecuta job de limpieza de reservas expiradas.

## Flujo core de compra
1. Cliente selecciona evento + tipos de ticket.
2. `POST /checkout/reserve` crea orden `reserved` + reservas de inventario con expiración.
3. `POST /checkout/confirm` simula pago, confirma orden y emite tickets.
4. Ticket se valida vía `GET /tickets/validate/:code` y se registra check-in con `POST /checkin/scan`.

## Migraciones y seed
- Esquema y migraciones SQL en `apps/api/prisma/migrations`.
- Seed en `apps/api/prisma/seed.ts`.

## Carga (k6)
- Script base en `loadtests/checkout-reserve.js`.
- Escenario hot-event (1000 VUs) en `loadtests/hot-event.js` con thresholds de `http_req_failed`, `p95` y chequeo de sobreventa en summary.

## Backups (guía operativa)
- Programar `pg_dump` diario + retención en almacenamiento externo.
- Verificar restauración periódicamente en entorno staging.



## Reproducibilidad
- El arranque de `api` ejecuta `prisma migrate deploy` y seed automáticamente para que una máquina limpia pueda iniciar con `docker compose up --build`.
- La lógica crítica de reservas/órdenes usa PostgreSQL como fuente de verdad (sin depender de Redis para consistencia de stock).


### Ejecutar hot event (reserva masiva)
```bash
k6 run loadtests/hot-event.js \
  -e API_URL=http://localhost:3000 \
  -e ORGANIZER_ID=<uuid> \
  -e EVENT_ID=<uuid> \
  -e TICKET_TYPE_ID=<uuid> \
  -e QUOTA=<cupo_ticket_type>
```

`oversell_suspected` en el summary de k6 es **solo señal heurística**; la validación real de no sobreventa se hace con la query SQL post-test.

### Verificación post-test de no sobreventa
```bash
DATABASE_URL=postgresql://articket:articket@localhost:5432/articket?schema=public \
EVENT_ID=<uuid> \
  sh loadtests/verify-no-oversell.sh
```

La consulta valida por `ticketTypeId` que `paid_qty + active_reservations_qty <= quota`.


### Ejecutar load test de confirmación/idempotencia
```bash
k6 run loadtests/confirm-idempotency.js \
  -e API_URL=http://localhost:3000 \
  -e ORGANIZER_ID=<uuid> \
  -e EVENT_ID=<uuid> \
  -e TICKET_TYPE_ID=<uuid>
```

Este escenario ejecuta `reserve + confirm` con la misma `paymentReference` repetida para simular reintentos/webhooks duplicados y comprobar idempotencia sin emisión duplicada a nivel API.


### Verificación DB de consistencia de emisión
```bash
DATABASE_URL=postgresql://articket:articket@localhost:5432/articket?schema=public \
EVENT_ID=<uuid> \
  sh loadtests/verify-consistency.sh
```

Esta verificación ejecuta:
1) `verify-no-oversell.sql` (no sobreventa en scope del test).
2) `verify-ticket-issuance-consistency.sql` (`tickets emitidos == SUM(order_items.quantity)` para órdenes paid).


3) `verify-expired-reservations.sql` (detecta reservas expiradas sin `releasedAt`, posible stock congelado).



## Ejecución reproducible de tests
Comando oficial (máquina limpia):
```bash
./scripts/test.sh
```

Detalles:
- `scripts/test.sh` ejecuta `docker compose run --rm api-test`.
- El contenedor usa `pnpm@9.12.0` instalado por `npm -g` en la imagen Docker (no depende de corepack para descargar pnpm).
- `.npmrc` permite configurar `NPM_REGISTRY`, `HTTP_PROXY`, `HTTPS_PROXY` por entorno.

## Notificaciones (SendGrid)
- Arquitectura: `checkout/confirm` encola job BullMQ (`order_paid_confirmation`) y el worker envía email fuera del request thread.
- Idempotencia de envío: el worker verifica `order.confirmationEmailSentAt`; si ya existe no reenvía.
- Templates: usar Dynamic Template ID en `SENDGRID_TEMPLATE_ORDER_PAID`.
- Webhook de SendGrid: `POST /webhooks/sendgrid` para registrar eventos (`delivered`, `bounce`, `spamreport`, etc.) en `email_events`.

### Variables de entorno
- `SENDGRID_API_KEY`
- `SENDGRID_FROM_EMAIL`
- `SENDGRID_TEMPLATE_ORDER_PAID`

### Endpoints mínimos
- `POST /orders/:id/resend-confirmation` (owner/admin/staff)
- `POST /webhooks/sendgrid`

### Worker
- Script: `pnpm --filter @articket/api worker:notifications`
- En `docker compose`, servicio `worker` dedicado ejecuta este proceso.


## Domain Events (Postgres)
- Se persisten eventos de dominio en la tabla `DomainEvent` para trazabilidad y futura analítica/BI.
- Helper central: `emitDomainEvent(type, context, payload)` (`apps/api/src/lib/domainEvents.ts`).
- Eventos emitidos actualmente:
  - `ORDER_RESERVED`
  - `ORDER_PAID`
  - `TICKETS_ISSUED`
  - `TICKET_CHECKED_IN`
  - `ORDER_CONFIRMATION_EMAIL_SENT`
- Índices en `DomainEvent`:
  - `(eventId, occurredAt)`
  - `(organizerId, occurredAt)`
  - `(type, occurredAt)`

### Uso futuro (métricas/BI)
- Alimentar agregaciones de negocio (ventas/minuto, check-ins/minuto, funnel reserve→paid).
- Construir pipelines de métricas/ETL sin acoplarse a tablas transaccionales principales.
- Base para dashboards operativos e históricos sin introducir Grafana/Influx en esta etapa.


## Actividad del evento (DomainEvent)
Endpoint backend:
- `GET /events/:eventId/activity`
- Auth requerida + RBAC (`owner/admin/staff/scanner`) con scoping por organizer del evento.
- Query params:
  - `limit` (default 50, máximo 200)
  - `cursor` (paginación)
  - `types` (lista separada por coma)
  - `includePayload` (solo devuelve payload si rol owner/admin)
- Orden: `occurredAt DESC, id DESC`.

Frontend:
- Vista `EventActivityPage` dentro del dashboard por evento: `/dashboard/events/:eventId/activity`.
- Filtros por `types`, botón “Cargar más” y detalle expandible por item.
- Cursor pagination con TanStack Query (`useInfiniteQuery`).

Uso futuro de DomainEvent para métricas/BI:
- Construir agregaciones temporales por evento/organizador/tipo sin acoplarse a tablas transaccionales.
- Base para dashboards operativos e históricos en próximas etapas.
