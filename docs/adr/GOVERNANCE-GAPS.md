# Governance Gaps — ADR Enforcement

Estado: detectado localmente (sin verificación de branch protection remota en GitHub).

## Gaps actuales
1. Falta `CODEOWNERS` para cambios en `docs/adr/**` y `docs/flows/**`.
2. Falta branch protection con required reviews para `main`.
3. Falta validación automática de formato ADR en CI.
4. Falta validación automática de trazabilidad (`ADR-*` vs `TRACEABILITY.md`).

## Cierre propuesto (orden recomendado)
### 1) CODEOWNERS
Agregar `.github/CODEOWNERS` con mínimo:

```txt
/docs/adr/** @<team-tech-reviewers>
/docs/flows/** @<team-tech-reviewers>
```

### 2) Branch protection (remoto GitHub)
Configurar para `main`:
- Require pull request reviews (mín. 1 técnico)
- Dismiss stale approvals on new commits
- Require status checks to pass
- Restrict direct pushes

### 3) ADR lint en CI
Agregar script `scripts/lint-adrs.sh` o `scripts/lint-adrs.js` que falle si:
- falta `Status` válido (`Proposed|Accepted|Deprecated`)
- faltan secciones mínimas (`Context`, `Decision`, `Decision Drivers`, `Consequences`, `Failure Modes`, `Operational Playbook`, `Audit Evidence`, `Metrics / SLIs`, `Rollback Plan`, `Related ADRs`, `Affected Modules`)

### 4) Traceability lint
Agregar chequeo que valide:
- cada `ADR-*.md` aparece en `docs/adr/TRACEABILITY.md`
- cada ADR referenciado en `Related ADRs` existe

## Definition of Done (gobernanza)
Se considera cerrado cuando:
- CODEOWNERS activo
- branch protection activa
- CI falla ante ADR incompleto
- CI falla ante trazabilidad incompleta
