# Backlog derivado del cierre de validación de check-in

Estado del bloque actual
- validado end-to-end
- mergeable: sí
- este backlog queda fuera de scope del bloque ya cerrado

## Contrato
- Documentar explícitamente el contrato real observado de `POST /checkin/scan`.
- Aclarar si el contexto del evento se resuelve por ruta, UI/sesión o server.
- Dejar asentado que en la UI validada el payload observado fue `{ code, gate }`.

## Operación / auditoría
- Definir más adelante si gate, puesto y operador deben persistirse como datos auditables por scan.
- Formalizar qué contexto operativo debe quedar trazado en cada validación.
- Resolver fuera de este bloque el tratamiento operativo explícito de re-scan / ticket ya usado.

## Tooling / E2E
- Endurecer la automatización E2E del scanner para no depender de hooks/manualidades del runtime del browser.
- Dejar una receta reproducible para generar tickets demo válidos en la misma instancia de validación.
- Revisar la anomalía de encoding solo si reaparece como bug real y no como artefacto de captura.
