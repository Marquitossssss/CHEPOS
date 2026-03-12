Check-in quedó validado end-to-end sobre una instancia estable del repo.

Alcance de la validación
- login real
- acceso real a /events/:eventId/checkin
- submit real desde la UI actual
- request real a POST /checkin/scan
- response real del backend
- mensaje visible final en UI en caso negativo y positivo

Contrato observado en la UI actual hacia /checkin/scan
Payload real observado:
{
  "code": "...",
  "gate": "Acceso principal"
}

Observación:
- eventId no fue parte del payload emitido por esta UI
- deviceLabel tampoco fue parte del payload emitido por esta UI
- cualquier payload más amplio mencionado antes no corresponde al contrato real observado en esta validación

Evidencia funcional cerrada

Caso negativo
- input UI: INVALID-CODE-123
- request real: POST /checkin/scan
- payload real:
  {
    "code": "INVALID-CODE-123",
    "gate": "Acceso principal"
  }
- status HTTP: 200
- response real:
  {
    "ok": false,
    "reason": "Firma inválida"
  }
- mensaje visible en UI:
  Firma inválida

Caso positivo
- ticket válido emitido por el flujo actual
- request real: POST /checkin/scan
- payload real:
  {
    "code": "<ticket válido emitido en esta instancia>",
    "gate": "Acceso principal"
  }
- status HTTP: 200
- response real:
  {
    "ok": true
  }
- mensaje visible en UI:
  Ingreso válido. Ticket marcado como utilizado para este evento.

Diagnóstico
- no se detectó bug real de producto en el flujo actual de check-in
- los problemas previos correspondían a entorno, datos demo viejos y códigos generados con datos/secreto no alineados con la instancia validada
- el flujo actual quedó validado de punta a punta con evidencia de backend y UI

Correcciones al informe anterior
- SED_* fue un typo de redacción; lo correcto en .env es SEED_*
- una versión previa mezcló payload hipotético con payload real observado; el contrato real probado en esta pantalla fue solamente { code, gate }

Pendientes fuera de scope
- documentar explícitamente el contrato real de /checkin/scan
- aclarar qué parte del contexto de check-in proviene de ruta, UI o server
- revisar más adelante la anomalía de encoding solo si reaparece como bug real

Conclusión
- estado: validado end-to-end
- mergeable: sí
- framing: mejora funcional validada del flujo de check-in, no rediseño completo del módulo de acceso
