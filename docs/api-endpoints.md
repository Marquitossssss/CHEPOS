# Endpoints API principales

## Auth
- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/refresh`

## Organizers / Events
- `POST /organizers` (auth requerido)
- `GET /organizers` (auth requerido)
- `GET /organizers/:id/invitations` (auth requerido; solo owner)
- `POST /organizers/:id/invitations` (auth requerido; solo owner)
- `POST /organizers/:id/invitations/:invitationId/resend` (auth requerido; solo owner; sin body)
- `POST /organizers/:id/invitations/:invitationId/revoke` (auth requerido; solo owner; sin body)
- `POST /organizers/invitations/accept` (auth requerido)
- `POST /events` (auth requerido)
- `GET /events?organizerId=<uuid>` (auth requerido)

### Organizer invitations (backend-only)
- `GET /organizers/:id/invitations`
  - response item:
    - `invitationId`
    - `organizerId`
    - `email`
    - `role`
    - `status`
    - `expiresAt`
    - `createdAt`
    - `createdByUserId`
    - `acceptedAt`
    - `acceptedByUserId`
    - `revokedAt`
    - `revokedByUserId`
    - `membershipId`
  - no devuelve `auditLogId`
- `POST /organizers/:id/invitations`
  - body: `{ email, role }`
  - roles permitidos: `admin | staff | scanner`
  - response:
    - `invitationId`
    - `organizerId`
    - `email`
    - `role`
    - `status`
    - `expiresAt`
    - `inviteToken`
    - `auditLogId`
  - `inviteToken` se expone porque este bloque no implementa email delivery real
- `POST /organizers/:id/invitations/:invitationId/resend`
  - sin body
  - response:
    - `invitationId`
    - `organizerId`
    - `email`
    - `role`
    - `status`
    - `expiresAt`
    - `inviteToken`
    - `auditLogId`
- `POST /organizers/:id/invitations/:invitationId/revoke`
  - sin body
  - response:
    - `invitationId`
    - `organizerId`
    - `status`
    - `revokedAt`
    - `auditLogId`
- `POST /organizers/invitations/accept`
  - body: `{ token }`
  - response:
    - `invitationId`
    - `membershipId`
    - `organizerId`
    - `userId`
    - `email`
    - `role`
    - `auditLogId`
- códigos HTTP:
  - `400` body inválido
  - `403` actor sin permiso
  - `404` recurso puntual inexistente / token inexistente / fuera del organizer
  - `409` conflicto de dominio o estado
- invariantes:
  - solo owner crea/lista/reenvía/revoca
  - una sola pending por `(organizerId, emailCanonical)`
  - resend rota token sobre la misma row
  - accept requiere usuario autenticado con email canonical coincidente
  - create/resend devuelven `inviteToken` por backend-only sin delivery real en scope

## Checkout
- `POST /checkout/reserve`
- `POST /checkout/confirm`

Ejemplo reserve:
```bash
curl -X POST http://localhost:3000/checkout/reserve \
  -H 'content-type: application/json' \
  -d '{"organizerId":"<org>","eventId":"<event>","customerEmail":"buyer@example.com","items":[{"ticketTypeId":"<tt>","quantity":1}]}'
```

## Check-in
- `GET /tickets/validate/:code`
- `POST /checkin/scan`

## Actividad
- `GET /events/:eventId/activity?limit=50&types=ORDER_PAID,TICKET_CHECKED_IN`
