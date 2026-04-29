# API principal (resumen)

## Auth
- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/refresh`
- `GET /authz/context`
  - para esta fase expone capacidades canónicas de organizer authz
  - capabilities de esta fase:
    - `viewOrganizerSettings`
    - `updateOrganizerSettings`
    - `viewOrganizerMembers`
    - `inviteOrganizerMembers`
    - `manageOrganizerMemberships`
    - `revokeOrganizerInvitations`

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

## Organizer authz capability model — fase 1
- source of truth canónica: `packages/shared/src/adminAuthz.ts`
- representación runtime del contexto: `GET /authz/context`
- capacidades definidas en esta fase:
  - `viewOrganizerSettings`
  - `updateOrganizerSettings`
  - `viewOrganizerMembers`
  - `inviteOrganizerMembers`
  - `manageOrganizerMemberships`
  - `revokeOrganizerInvitations`
- mapping real validado en esta fase:
  - `owner`
    - `viewOrganizerSettings`
    - `updateOrganizerSettings`
    - `viewOrganizerMembers`
    - `inviteOrganizerMembers`
    - `manageOrganizerMemberships`
    - `revokeOrganizerInvitations`
  - `admin`
    - `viewOrganizerSettings`
    - `viewOrganizerMembers`
    - no puede `updateOrganizerSettings`
    - no puede `inviteOrganizerMembers`
    - no puede `manageOrganizerMemberships`
    - no puede `revokeOrganizerInvitations`
  - `staff`
    - sin capacidades de organizer settings / memberships / invitations en esta fase
  - `scanner`
    - sin capacidades de organizer settings / memberships / invitations en esta fase
- enforcement endurecido en esta fase:
  - `GET /organizers/:id/memberships` -> `viewOrganizerMembers`
  - `POST /organizers/:id/memberships` -> `manageOrganizerMemberships` (owner-only por mapping real)
  - `POST /organizers/:id/memberships/:membershipId/role` -> `manageOrganizerMemberships` (owner-only por mapping real)
  - `DELETE /organizers/:id/memberships/:membershipId` -> `manageOrganizerMemberships` (owner-only por mapping real)
  - `GET /organizers/:id/invitations` -> owner-only
  - `POST /organizers/:id/invitations` -> owner-only
  - `POST /organizers/:id/invitations/:invitationId/resend` -> owner-only
  - `POST /organizers/:id/invitations/:invitationId/revoke` -> owner-only
  - `POST /organizers/invitations/accept` -> fuera del capability model del actor organizacional; depende de token + email autenticado
- invariantes contractuales validadas:
  - membership lifecycle create / role change / remove = owner-only
  - organizer invitations list / create / resend / revoke = owner-only
  - admin puede leer memberships y recibe capabilities coherentes en `/authz/context` y en el listado de memberships
- fuera de scope de esta fase:
  - payments
  - dashboard / analytics
  - check-in
  - inventario
  - frontend/UI
- deuda operativa validada en el rerun local:
  - la validación verde reutilizó `Postgres` y `Redis` Docker externos al compose context actual del workspace
  - contenedores observados: `chepos-postgres-1` y `chepos-redis-1`

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
- `GET /orders/:orderId/case-view`
  - auth requerido
  - capability real: `viewOrderCase`
  - contrato read-only para backoffice/soporte
  - devuelve secciones separadas: `orderSummary`, `eventSummary`, `buyerSummary`, `itemSummary`, `paymentSummary`, `ticketSummary`, `reservationSummary`, `latePaymentCaseSummary`, `operationalTimeline`, `auditSummary`
  - minimiza PII: email enmascarado, refs PSP enmascaradas, sin payload raw de PSP, sin QR/códigos completos, sin metadata raw de auditoría
  - doc operativo: `docs/ops/order-case-view.md`
- `POST /orders/sensitive-lookup`
  - auth requerido
  - capability real dedicada: `sensitiveOrderLookup` (`viewOrderCase` no alcanza para buscar por dato sensible)
  - request: `queryType` (`email | orderId | paymentReference`), `query`, `organizerId`, `eventId?`, `reason`
  - `reason` es obligatorio, trimmeado, mínimo 12 caracteres, y queda auditado
  - scope: `organizerId` obligatorio; si se envía `eventId`, debe pertenecer al organizer; capability sin scope válido => 403
  - respuesta mínima: `results[]` con `orderId`, `eventId`, `eventTitle`, `orderStatus`, `paymentStatus`, `latePaymentCaseStatus`, `buyerDisplay` enmascarado, `createdAt`, `caseViewAvailable`, y `meta.limited`
  - seguridad: no devuelve customerEmail completo, providerRef completo, ticket code, qrPayload, payload raw de payments/webhooks, metadata raw de auditoría ni datos de otros organizers
  - auditoría: crea `AuditLog` `action=sensitive_order_lookup` con actor, organizer, event opcional, queryType, fingerprint SHA-256 de la query normalizada, reason y bucket/conteo limitado
  - revelación operativa ampliada: primero lookup mínimo; luego `GET /orders/:orderId/case-view` con `viewOrderCase`
  - DNI/documento: UNVERIFIED/deferred; el schema actual no tiene campo de DNI/documento y no se inventó columna ni migración
- `POST /orders/:id/resend-confirmation`
  - auth requerido
  - request body obligatorio: `{ organizerId, reason }`
  - capability real dedicada: `resendOrderConfirmation` (`viewOrderCase` no alcanza)
  - permitidos: `owner`, `admin`
  - denegados en el mapping actual: `staff`, `scanner`
  - scope: primero capability sobre `organizerId`; luego búsqueda por `(order.id, organizerId)` para no exponer órdenes de otro organizer
  - `reason` obligatorio, trimmeado, mínimo 12 caracteres, queda auditado
  - elegibilidad: solo `order.status = paid`, tickets emitidos existentes y email reenviable válido
  - no elegibles => `409`
  - respuesta mínima: `{ orderId, status: "queued", emailMasked, auditId }`
  - side effects prohibidos del contrato: no crea tickets nuevos, no toca inventory, no toca payment state, no resuelve `LatePaymentCase`
  - auditoría: crea `AuditLog` `action=order_confirmation_resend_requested` con actor, organizer, event, reason, correlationId, queueJobId y `emailMasked`
  - entrega async: `queued` significa encolado; no garantiza entrega final inmediata
  - minimización: no devuelve customerEmail completo, providerRef, ticket code, qrPayload ni payloads raw
  - deuda vigente: no hay outbox formal; el flujo depende de BullMQ + worker + SendGrid

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
