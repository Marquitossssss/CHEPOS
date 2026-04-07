# API principal (resumen)

## Auth
- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/refresh`
- `GET /authz/context`

## Organizers / Events
- `POST /organizers`
- `GET /organizers`
- `GET /organizers/:id/invitations`
- `POST /organizers/:id/invitations`
- `POST /organizers/:id/invitations/:invitationId/resend`
- `POST /organizers/:id/invitations/:invitationId/revoke`
- `POST /organizers/invitations/accept`
- `POST /events`
- `GET /events?organizerId=<uuid>`
- `POST /events/:id/ticket-types`
- `GET /events/:id/ticket-types`

### Invitations backend-only
- `GET /organizers/:id/invitations`
  - auth requerido
  - solo owner
  - lista invitaciones con: `invitationId, organizerId, email, role, status, expiresAt, createdAt, createdByUserId, acceptedAt, acceptedByUserId, revokedAt, revokedByUserId, membershipId`
  - **no** devuelve `auditLogId`
- `POST /organizers/:id/invitations`
  - auth requerido
  - solo owner
  - body: `{ email, role }` donde `role ∈ {admin, staff, scanner}`
  - crea invitación `pending`
  - response: `invitationId, organizerId, email, role, status, expiresAt, inviteToken, auditLogId`
  - `inviteToken` se devuelve porque este bloque es backend-only y no hay email delivery real en scope
  - conflictos reales: membership existente `409`, pending duplicada por `(organizerId, emailCanonical)` `409`
- `POST /organizers/:id/invitations/:invitationId/resend`
  - auth requerido
  - solo owner
  - sin body
  - rota token sobre la misma invitación pending y renueva `expiresAt`
  - response: `invitationId, organizerId, email, role, status, expiresAt, inviteToken, auditLogId`
- `POST /organizers/:id/invitations/:invitationId/revoke`
  - auth requerido
  - solo owner
  - sin body
  - solo revoca desde `pending` con `expiresAt > now`
  - response: `invitationId, organizerId, status, revokedAt, auditLogId`
- `POST /organizers/invitations/accept`
  - auth requerido
  - body: `{ token }`
  - acepta solo si `status = pending`, `expiresAt > now` y el email autenticado coincide con `emailCanonical`
  - crea membership + marca accepted + audita en una transacción
  - response: `invitationId, membershipId, organizerId, userId, email, role, auditLogId`
- códigos HTTP reales del bloque:
  - `400` body inválido
  - `403` actor sin permiso
  - `404` recurso puntual inexistente / token inexistente / recurso fuera del organizer
  - `409` conflicto de dominio o estado
- invariantes clave:
  - una sola pending por `(organizerId, emailCanonical)`
  - token persistido solo como hash
  - resend rota token y el anterior deja de ser válido
  - onboarding de usuario inexistente queda fuera de scope
  - email delivery real queda fuera de scope

## Checkout
- `POST /checkout/reserve`
- `POST /checkout/confirm`

### Ejemplo reserve
```bash
curl -X POST http://localhost:3000/checkout/reserve \
  -H 'content-type: application/json' \
  -d '{"organizerId":"<org>","eventId":"<event>","customerEmail":"buyer@example.com","items":[{"ticketTypeId":"<tt>","quantity":1}]}'
```

## Actividad de evento
- `GET /events/:eventId/activity?limit=50&types=ORDER_PAID,TICKET_CHECKED_IN`
- `GET /api/events/:eventId/dashboard?range=7d&bucket=day`

## Operación
- `GET /late-payment-cases`
  - auth requerido
  - capability real: `viewLatePaymentCases`
  - DTO final: `id, organizerId, eventId, orderId, provider, paymentAttemptId, status, reason, detectedAt, resolvedAt, resolutionNotes, version`
- `POST /late-payment-cases/:id/resolve`
  - auth requerido
  - capability real: `resolveLatePayments`
  - action matrix real:
    - `PENDING -> ACCEPT | REJECT | REFUND_REQUESTED | REFUNDED`
    - `REFUND_REQUESTED -> REFUNDED`
    - terminales -> sin acción
- `POST /orders/:id/resend-confirmation`

## Trust boundary de payments webhook
- `POST /webhooks/payments/:provider`
- providers reales => firma + timestamp obligatorios
- validación de skew en segundos Unix reales con `Math.floor(now.getTime() / 1000)`
- `mock` => firma opcional solo fuera de production
- `PaymentEvent.payloadJson` guarda solo payload raw del provider
- la deduplicación de replay se resuelve por `(provider, providerEventId)`

## Read perimeter público
- `GET /events/:id/ticket-types` expone solo catálogo mínimo de eventos `published`
- `GET /tickets/validate/:code` devuelve solo `{ valid: true }` o `{ valid: false, reason }`
- `/metrics` no queda silenciosamente abierto en production sin token
