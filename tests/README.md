# Tests de integración / contrato

Este directorio está reservado para pruebas de integración y contrato cross-módulo.

Actualmente:
- contratos de DomainEvent y activity viven en `apps/api/src/**.test.ts`
- loadtests y verificaciones SQL viven en `/loadtests`

Comando oficial reproducible:
```bash
./scripts/test.sh
```
