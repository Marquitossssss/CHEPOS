# ADRs (Architecture Decision Records)

## Propósito
Registrar decisiones arquitectónicas como contrato auditable: qué decidimos, por qué, consecuencias y cómo operarlo.

## Estados
- Proposed
- Accepted
- Deprecated

## Numeración
ADR-0000, ADR-0001, ...

## Definition of Done (mínimo)
Cada ADR debe incluir:
- Status (**obligatorio**: Proposed / Accepted / Deprecated)
- Date (ISO 8601: `YYYY-MM-DD`)
- Owners (rol/equipo; evitar persona individual cuando aplique)
- Context
- Decision
- Decision Drivers
- Alternatives (mínimo 2)
- Consequences (positivas y negativas)
- Failure Modes (detección, mitigación automática, acción operativa)
- Operational Playbook (qué hace soporte en incidentes)
- Audit Evidence (qué IDs/logs quedan)
- Metrics/SLIs (cómo se verifica en prod; preferir P95/P99)
- Rollback Plan (cómo se revierte)
- Related ADRs (enlaces cruzados)
- Affected Modules (mapeo a código)

## Plantilla
Copiar y ajustar:

---

# ADR-XXXX: <título>

- Status: Proposed
- Date: YYYY-MM-DD
- Owners: <equipo/rol>

## Context
<qué problema real se resuelve>

## Decision
<qué se decide>

## Decision Drivers
- <driver 1>
- <driver 2>
- <driver 3>

## Consequences
**Pros**
- ...

**Cons**
- ...

## Operational Playbook
- Trigger:
- Triage:
- Action:
- Escalation:
- Post-incident:

## Audit Evidence
- Correlation IDs:
- Domain events:
- Payment provider IDs:
- Persisted artifacts:

## Metrics / SLIs
- ...

## Rollback Plan
- ...

## Related ADRs
- ADR-0000
- ADR-0002

## Affected Modules
- apps/api/src/modules/<module>
- apps/api/src/domain/<domain>
- apps/web/src/<feature>
