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
- Status (Proposed/Accepted/Deprecated)
- Context
- Decision
- Decision Drivers
- Consequences (positivas y negativas)
- Operational Playbook (qué hace soporte en incidentes)
- Audit Evidence (qué IDs/logs quedan)
- Metrics/SLIs (cómo se verifica en prod)
- Rollback Plan (cómo se revierte)

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
