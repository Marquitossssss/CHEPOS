# ADR-0007: Layout inventory enforcement roadmap

- Status: Proposed
- Date: 2026-04-30
- Owners: Backend / Inventory / Checkout

## Context
Después de `Venue Layouts v0.1` e `Inventory Layout Binding v0.1`, el sistema ya puede:

- guardar `EventLayoutSnapshot` inmutable por evento;
- declarar bindings entre entidades del snapshot (`zone` / `seat`) y `TicketType` mediante `EventLayoutInventoryBinding`;
- auditar la creación de esos bindings.

Pero el checkout actual sigue operando exclusivamente sobre inventario agregado por `TicketType`.

Estado real implementado hoy:

- `POST /checkout/reserve` acepta `items[{ ticketTypeId, quantity }]` y no acepta `seatId`, `zoneId`, `layoutEntityId` ni `bindingId`.
- `POST /checkout/confirm` confirma una orden basada en `TicketType`, emite tickets genéricos y no asigna entidad de layout.
- `EventLayoutInventoryBinding` es declarativo/administrativo: define una intención de mapeo, pero no gobierna reservas operativas.
- `capacityLimit` se valida al crear el binding, pero no se enforcea durante `reserve`, `confirm`, webhooks ni TTL release.
- `Ticket` no guarda `seatId`, `zoneId`, `layoutEntityId` ni `bindingId`.
- `InventoryReservation` no reserva entidad física del layout; solo reserva cantidad por `ticketTypeId`.
- La protección `no_oversell` sigue dependiendo de `TicketType.remaining` + `InventoryReservation` + TTL release.

Conclusión operativa: el producto todavía no debe venderse como "seat inventory operativo" o "seat selection productivo". El estado actual es preparación administrativa para una evolución posterior.

## Decision
Se adopta explícitamente un roadmap por fases para evolucionar desde binding declarativo hacia enforcement real de inventario espacial, sin reescribir checkout de una sola vez.

### Decisión de estado actual
- El checkout actual sigue siendo un checkout por `TicketType`.
- `EventLayoutInventoryBinding` en v0.1 se considera una capa administrativa, no el origen operativo de truth para reservas de layout.
- `capacityLimit` en v0.1 se considera metadata declarativa, no control transaccional de stock.
- No se debe comunicar comercialmente que el sistema ya soporta seat inventory operativo.

### Roadmap aprobado

#### v0.2 — Zone capacity enforcement
Objetivo: introducir enforcement por zona sin entrar todavía en butaca individual.

Alcance esperado:
- `reserve` acepta `layoutEntityType=zone` + `layoutEntityId`, o `bindingId`.
- checkout valida que exista binding activo para el evento y snapshot vigente.
- `capacityLimit` pasa a ser un límite transaccional efectivo.
- la reserva registra referencia al binding o entidad de layout consumida.
- no se implementa seat-level selection todavía.

No alcance:
- seat picker interactivo;
- reserva de butaca individual;
- ticket nominalizado a seat.

#### v0.3 — Seat-level reservations
Objetivo: introducir inventario espacial por asiento.

Alcance esperado:
- `reserve` acepta `seatId` o equivalente de entidad `seat`.
- una butaca no puede reservarse dos veces en simultáneo.
- `InventoryReservation` y `Ticket` guardan referencia trazable a la entidad del layout.
- TTL libera el hold del seat.
- `confirm` emite ticket trazable a la butaca concreta.

No alcance:
- experiencia visual final de frontend;
- optimizaciones avanzadas de picker;
- reglas comerciales complejas de reacomodo automático.

#### v0.4 — Checkout / seat picker / UI
Objetivo: cerrar la experiencia comercial completa para selección visual.

Alcance esperado:
- frontend con mapa de sala;
- selección interactiva de zona/butaca;
- estados visuales de disponibilidad / hold / vendida;
- reporting visual operacional.

## Decision Drivers
- El estado actual ya protege oversell agregado por `TicketType`, pero no oversell espacial por layout.
- Cambiar checkout, TTL, webhooks y ticketing en un solo salto aumenta riesgo de regresión en pagos e inventario.
- La trazabilidad `ticket -> entidad física` es obligatoria antes de vender asientos numerados en serio.
- La operación necesita separar claramente "binding administrativo" de "enforcement comercial".
- El sistema debe preservar idempotency, ticket_issue_once y convergencia de webhooks mientras evoluciona.

## Alternatives

### Alternative A — vender el estado actual como seat inventory operativo
Rechazada.

Por qué no:
- checkout no selecciona entidades de layout;
- `capacityLimit` no controla stock en runtime;
- tickets no son trazables a seat/zone;
- el riesgo de promesa falsa al negocio es alto.

### Alternative B — reescribir todo el checkout a seat-level en un solo release
Rechazada.

Por qué no:
- mezcla demasiados cambios críticos a la vez;
- aumenta el riesgo sobre pagos, webhooks, TTL e idempotency;
- dificulta aislar fallas y rollback.

### Alternative C — roadmap incremental binding -> zone -> seat -> UI
Aceptada.

Por qué sí:
- preserva el checkout actual mientras agrega enforcement por capas;
- permite validar riesgos transaccionales antes de meter UI compleja;
- mantiene trazabilidad clara entre estado actual y objetivo futuro.

## Consequences
**Pros**
- Alinea producto, backend y operación con el estado real del sistema.
- Evita vender una capacidad que todavía no existe en runtime.
- Permite introducir enforcement espacial sin romper de entrada el modelo actual de pagos.
- Facilita testing incremental por capas: zona primero, seat después.
- Reduce el riesgo de regresión sobre `TicketType.remaining`, TTL release y webhooks.

**Cons**
- El binding actual queda explícitamente limitado: aporta valor administrativo pero no valor comercial pleno.
- Habrá un período intermedio con modelo mixto: inventario agregado real + metadata espacial parcial.
- v0.2 agrega complejidad de consistencia entre stock agregado y stock por zona.
- v0.3 obliga a rediseñar persistencia y trazabilidad de reservation/ticket.
- La UI final depende de varias iteraciones previas, no de una única entrega.

## Failure Modes

### 1. Race conditions en reserve por la misma zona o seat
- Detección: conflictos de write, retries anómalos, aumento de rechazos por conflicto.
- Mitigación automática esperada: locks determinísticos, índices únicos / guards transaccionales por entidad espacial.
- Acción operativa: revisar colisión por evento, aislar si el problema es por lock ordering o por ausencia de constraint.

### 2. Double reservation espacial con stock agregado todavía disponible
- Detección: zona/seat reservado más de una vez, o sumatoria espacial menor al stock agregado vendido.
- Mitigación automática esperada: enforcement por binding/layout entity antes de confirmar reserva.
- Acción operativa: congelar venta afectada, auditar reservations/tickets y corregir asignaciones.

### 3. Webhook late payment llega después de expirar el hold espacial
- Detección: pago exitoso sobre orden sin hold activo, o hold ya liberado.
- Mitigación automática esperada: flujo análogo a `paid_no_stock`, pero considerando inventario espacial además del agregado.
- Acción operativa: abrir caso operativo, impedir emisión incorrecta y definir compensación/manual review.

### 4. TTL release libera stock agregado pero no libera entidad espacial
- Detección: divergencia entre `remaining` y disponibilidad espacial calculada.
- Mitigación automática esperada: liberar en la misma transacción tanto agregado como espacial.
- Acción operativa: reconciliación y alerta de drift por evento.

### 5. Idempotency de reserve/confirm preserva orden pero duplica consumo espacial
- Detección: misma orden o mismo `clientRequestId` asociado a más de una entidad física.
- Mitigación automática esperada: idempotency key debe cubrir también la dimensión espacial del request.
- Acción operativa: revisar payload persistido e invariantes del request original.

### 6. ticket_issue_once se mantiene, pero sin trazabilidad correcta a layout entity
- Detección: ticket emitido sin referencia espacial cuando la venta ya debería ser espacial.
- Mitigación automática esperada: emitir ticket solo si la asignación espacial está materializada.
- Acción operativa: bloquear rollout de seat inventory hasta cerrar esa trazabilidad.

### 7. Refunds/cancellations futuras no restauran entidad espacial
- Detección: seat/zone sigue ocupado después de cancelación o refund efectivo.
- Mitigación automática esperada: política explícita de restitución espacial por estado de negocio.
- Acción operativa: corrida de reconciliación y playbook de reasignación/liberación.

## Operational Playbook
- Trigger:
  - reclamos de butacas duplicadas;
  - drift entre stock agregado y stock espacial;
  - pagos tardíos sobre holds vencidos;
  - emisión de tickets sin trazabilidad espacial en fases futuras.
- Triage:
  - identificar evento, snapshot, binding, orderId, reservationId, paymentId y correlationId;
  - separar si el incidente es agregado (`TicketType`) o espacial (`zone` / `seat`).
- Action:
  - congelar venta del evento si hay evidencia de doble asignación;
  - correr reconciliación entre `remaining`, reservations activas, tickets emitidos y entidades espaciales afectadas;
  - derivar late payments a cola de revisión manual cuando el hold espacial ya no exista.
- Escalation:
  - Backend / Checkout si falla consistencia transaccional;
  - Operaciones / Soporte si ya impactó clientes;
  - Producto si el gap afecta promesa comercial.
- Post-incident:
  - documentar drift detectado;
  - agregar test de regresión;
  - revisar si falta lock, constraint o contrato de idempotency.

## Audit Evidence
- Correlation IDs:
  - `checkout reserve`
  - `checkout confirm`
  - `webhooks.payments`
  - `releaseExpiredReservations`
- Domain events:
  - `ORDER_RESERVED`
  - `ORDER_PAID`
  - `ORDER_EXPIRED`
  - `TICKETS_ISSUED`
  - `PAYMENT_MARKED_NO_STOCK`
- Audit logs:
  - `event_layout_inventory_binding_created`
- Persisted artifacts:
  - `EventLayoutSnapshot`
  - `EventLayoutInventoryBinding`
  - `Order`
  - `InventoryReservation`
  - `Ticket`
  - `Payment`
  - `LatePaymentCase`

## Metrics / SLIs
Fases futuras deberían observar como mínimo:
- P95/P99 de `checkout reserve` por path agregado vs espacial.
- tasa de conflictos por zona/seat.
- cantidad de TTL releases con liberación espacial.
- cantidad de late payments que llegan sin hold espacial activo.
- drift detector: diferencia entre stock agregado vendido y stock espacial asignado.
- count de tickets emitidos sin referencia espacial cuando la fase ya la requiera.

## Rollback Plan
- v0.2: fallback a venta solo por `TicketType`, ignorando input espacial y deshabilitando enforcement por binding.
- v0.3: desactivar seat-level reservation y volver temporalmente a zone-level o agregado.
- v0.4: apagar UI de seat picker y mantener checkout no visual mientras backend conserva consistencia.
- Regla general: si la consistencia espacial compromete ventas, priorizar la preservación del checkout agregado ya validado.

## Related ADRs
- ADR-0003
- ADR-0006-payments-current-semantics
- ADR-0000-product-reality

## Affected Modules
Estado actual documentado en:
- `packages/shared/src/index.ts`
- `apps/api/src/server.ts`
- `apps/api/src/modules/payments/applyPaymentEvent.ts`
- `apps/api/src/jobs/releaseExpiredReservations.ts`
- `apps/api/src/modules/venues/venueLayouts.routes.ts`
- `apps/api/prisma/schema.prisma`

Fases futuras impactarán además:
- `apps/web/src/*` o frontend equivalente de checkout / seat picker
- contratos API de reserve/confirm
- modelo de reservations/tickets con trazabilidad espacial
