# Order Case View Backend Contract

## Purpose

`GET /orders/:orderId/case-view` gives backoffice/support a minimal operational view of one order without exposing raw tables or unnecessary PII. It is read-only and does not resolve late-payment cases, issue tickets, refund payments, or trigger emails.

## Permission

- Auth required.
- Backend enforced capability: `viewOrderCase` on the order organizer scope.
- Owner/admin/staff have the capability by default; scanner does not.
- A user with the capability on another organizer is denied.

## Response sections

The endpoint returns separated sections:

- `orderSummary`: ids, status, timestamps, reservedUntil, total/currency, eventId, organizerId, late-payment review flag.
- `eventSummary`: event id/name, organizerId, venue, starts/ends/timezone when available.
- `buyerSummary`: masked email only (`emailMasked`). No DNI/document data.
- `itemSummary`: ticket type id/name, quantity, unit price, subtotal, currency.
- `paymentSummary`: payment rows and provider event summaries with masked provider refs/event ids; no PSP raw payload.
- `ticketSummary`: counts, status distribution, issue/check-in timestamps and ticket ids; no QR payload and no ticket code.
- `reservationSummary`: active/released status, expiresAt, releasedAt and releaseReason.
- `latePaymentCaseSummary`: case id/status/provider, masked provider payment id, payment attempt id, inventory release flag, detected/resolved metadata and resolution notes.
- `operationalTimeline`: summarized `DomainEvent` entries ordered by `occurredAt`; payload is intentionally not returned.
- `auditSummary`: summarized `AuditLog` entries for the order/case actions, separated from operational timeline; full metadata/before/after payload is intentionally not returned.

## Data minimization policy

Do not return by default:

- full `customerEmail`
- DNI/document fields
- raw `PaymentEvent.payloadJson`
- full PSP provider references/event ids
- ticket `code` or `qrPayload`
- raw `DomainEvent.payload`
- raw `AuditLog.metadata` before/after objects

Future expansion that exposes broader PII must use a separate explicit capability, not `viewOrderCase`.

## Timeline vs audit

- `operationalTimeline` answers what happened in the business flow from `DomainEvent`.
- `auditSummary` answers who changed sensitive state and when from `AuditLog`.
- They are intentionally separate so backoffice does not treat an audit trail as the operational narrative or vice versa.

## Known limits

- This is a backend contract only; no UI is included.
- Pagination is not implemented because the view is scoped to one order and caps timeline/audit reads at 100 rows each.
- PSP refund execution and manual ticket issuance remain out of scope.
