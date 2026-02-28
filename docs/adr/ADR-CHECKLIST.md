# ADR Acceptance Checklist (includes mandatory Failure Modes)

Use this checklist to accept/reject each ADR-0001..0006.

## A) Completeness
- [ ] Context claro + problema real
- [ ] Decisión explícita (no “podría ser”)
- [ ] Alternativas consideradas (mínimo 2)
- [ ] Consecuencias listadas (costos, complejidad, operación)

## B) Operability
- [ ] Incluye “cómo se opera” en producción
- [ ] Incluye métricas/alertas afectadas o necesarias
- [ ] Incluye plan de rollback o migración si aplica

## C) Failure Modes (obligatorio)
- [ ] ¿Qué pasa si el proveedor externo falla?
- [ ] ¿Qué pasa con duplicados (webhooks, requests, jobs)?
- [ ] ¿Qué pasa con delays (colas, red, DB)?
- [ ] ¿Qué pasa en peak window (evento en curso)?
- [ ] ¿Cómo detectamos el fallo? (señal/alerta)
- [ ] ¿Cómo lo mitiga el sistema? (automático)
- [ ] ¿Qué hace el operador? (runbook mínimo)

## D) Security & Data
- [ ] Define scoping multi-tenant
- [ ] Idempotency donde corresponda
- [ ] Audit trail definido si toca tickets/pagos/check-in
- [ ] PII minimizada y protegida

## Verdict
- **ACCEPT** si todo OK.
- **REJECT** si falta decisión, faltan números, o no hay Failure Modes.
