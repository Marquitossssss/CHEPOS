# PR Checklist — `integration/sprint-0` -> `main`

Checklist mínima para merge seguro a `main`.

## 1) Build/Test/Verify
- [ ] `bash scripts/test.sh` en verde
- [ ] `bash scripts/verify.sh` en verde
- [ ] `docker compose up -d postgres redis api` con `api` healthy

## 2) Consistencia transaccional
- [ ] `verify-no-oversell.sql` devuelve `no_oversell = t`
- [ ] `verify-ticket-issuance-consistency.sql` devuelve `consistent = t`
- [ ] `verify-expired-reservations.sql` sin filas stale

## 3) Seguridad y configuración
- [ ] Sin secretos hardcodeados en compose/código
- [ ] `.env.example` actualizado y consistente
- [ ] QR firmado valida/invalidación testeada (`qr.test.ts`)

## 4) Operación
- [ ] `/health` responde OK
- [ ] `/metrics` responde y respeta `METRICS_TOKEN` si está seteado
- [ ] Worker de notificaciones con health endpoint (`:9101/health`)

## 5) Calidad de cambio
- [ ] Commits con mensajes claros
- [ ] Sin cambios accidentales fuera de alcance
- [ ] Documentación actualizada (si aplica)

## 6) Criterio de merge
Hacer merge solo si:
1. Todo verde en local/CI
2. No hay riesgo abierto de oversell/duplicación de pago/check-in
3. Runbook operativo disponible para incidentes básicos

---

## Comando recomendado pre-merge
```bash
bash scripts/verify.sh
```

Si falla por falta de `EVENT_ID`, el script ya intenta sembrar datos automáticamente.
