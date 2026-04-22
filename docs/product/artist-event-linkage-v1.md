# Artist ↔ Event Linkage v1

## Estado inicial real del repo

Hoy la relación dominante es:
- `Organizer 1:N Event`
- `Event 1:N TicketType`

No existe relación explícita entre artistas y eventos.

`Event` contiene apenas un `venue` string y un `description`, pero no performers estructurados.

---

## Alternativas evaluadas

### A. Campo simple en `Event`
Ejemplo conceptual:
- `event.artistName`
- `event.artistBio`

#### Ventajas
- implementación muy barata
- impacto técnico inmediato bajo

#### Problemas
- dominio débil
- duplicación editorial alta
- imposible o frágil para múltiples artistas por evento
- pobre para “shows by artist”
- pobre para reutilizar contenido canónico

#### Veredicto
**Incorrecta** para el objetivo del bloque.

---

### B. `Artist + Event` 1:N
Ejemplo conceptual:
- cada evento tiene un único `artistId`

#### Ventajas
- mejor que campo simple
- baja complejidad de queries

#### Problemas
- asume un solo artista por evento
- modela mal festivales, ciclos, eventos con opening/support/lineup
- fuerza hacks futuros si un show tiene múltiples actos

#### Veredicto
**Débil**. Sólo sirve si el producto fuera estrictamente “1 artista principal por show”, y el repo no demuestra eso como invariante.

---

### C. `Artist + EventArtist` N:N
Ejemplo conceptual:
- `Artist`
- `EventArtist`

#### Ventajas
- robustez de dominio correcta
- soporta múltiples artistas por evento
- soporta múltiples shows por artista
- evita duplicación editorial
- buen punto de partida para artist page, shows by artist, artists by event
- costo de implementación moderado

#### Problemas
- más trabajo que A/B
- exige definir reglas mínimas de orden/rol de participación

#### Veredicto
**Aceptable / recomendado**.

---

### D. `Artist + EventArtist + Tour/Series` desde ya
#### Ventajas
- diseño más completo hacia producto editorial rico
- soporta agregaciones futuras por gira/ciclo

#### Problemas
- sobre-modelado para el estado real del repo
- no hay evidencia actual de necesidad operativa inmediata
- agrega otra raíz conceptual antes de validar `Artist`

#### Veredicto
**Prematuro** para este bloque.

---

## Decisión recomendada

### Relación correcta: `Artist` ↔ `Event` como N:N mediante `EventArtist`

### Por qué
1. Un artista puede tener muchos shows.
2. Un evento puede tener uno o varios artistas.
3. Es el mínimo correcto para evitar deuda de dominio futura.
4. Evita fijar un falso invariante 1 artista = 1 evento.

---

## Qué es `EventArtist` en v1

`EventArtist` es la relación explícita entre el acto canónico (`Artist`) y el show concreto (`Event`).

No duplica la bio del artista. Su función es describir **participación en el evento**, no identidad editorial canónica.

---

## Subset mínimo de campos para `EventArtist v1`

### Campos recomendados
- `id`
- `eventId`
- `artistId`
- `billingOrder` nullable
- `billingLabel` nullable
- `isPrimary` boolean
- `createdAt`
- `updatedAt`

### Significado
- `billingOrder`: orden de cartel / presentación
- `billingLabel`: texto corto opcional como `headline`, `support`, `guest`, `opening`, sin convertirlo todavía en taxonomía rígida
- `isPrimary`: ayuda a resolver listados básicos y casos “artista principal” sin asumir unicidad permanente del evento

---

## Invariantes recomendados para `EventArtist v1`

1. Un mismo par `eventId + artistId` no debe duplicarse.
2. `EventArtist` no es la fuente de bio, links o hero image del artista.
3. `billingOrder` ordena presencia editorial dentro del evento, no reemplaza la canonicidad del artista.
4. Puede haber más de un artista relacionado al mismo evento.
5. Puede haber más de un evento relacionado al mismo artista.

---

## Qué no conviene meter todavía en `EventArtist`

No modelar aún:
- set times
- stage/escenario
- caché/fee contractual
- hospitality/logística
- rider técnico
- relación de management
- snapshots editoriales completos por evento
- lineup trees complejos

---

## Tour / Series

### Decisión
**No modelar Tour/Series en este bloque.**

### Por qué
- no existe evidencia actual en repo
- no hace falta para resolver identidad canónica + múltiples shows
- meter `Tour` ahora crea otra dimensión de producto sin necesidad operativa inmediata

### Regla para el futuro
Si más adelante aparece necesidad real de agrupar eventos bajo una gira/ciclo, `Tour` debería agregarse por separado, no mezclado con la decisión base `Artist ↔ Event`.

---

## Recomendación final

- Modelar `Artist` como entidad propia.
- Modelar `EventArtist` como join N:N.
- No introducir `Tour/Series` todavía.
- Mantener `Event` como raíz operativa del show y `Artist` como raíz editorial del acto.

---

## Cierre auditable del bloque: `Artist v1 Surfaces — Admin Event Linkage`

### Estado
**GREEN / cerrado funcionalmente** para el alcance definido de admin event linkage.

### Evidencia usada
Validación realizada sobre runtime funcional con:
- login real
- organizer real
- event real
- authz real con `manageTicketTypes = true`
- smoke por endpoints reales del ciclo completo

Ciclo smoke ya ejecutado y aceptado:
- listado vacío
- artists disponibles
- vinculación
- edición de `billingOrder`
- edición de `billingLabel`
- edición de `isPrimary`
- desvinculación

### Alcance validado en GREEN
- listar artistas por evento
- listar artistas disponibles para vincular
- vincular artista a evento
- editar metadata del vínculo
  - `billingOrder`
  - `billingLabel`
  - `isPrimary`
- desvincular artista de evento

### Exclusiones explícitas del bloque
Quedan fuera de este cierre:
- quick-create de artist
- artist page pública
- surfaces editoriales

### Deuda residual registrada (no reabre el bloque)
1. **Verificación visual/browser opcional**
   - residual de validación UX/superficie
   - no bloquea el cierre funcional/runtime del slice

2. **Contrato residual para futuro quick-create**
   - `POST /artists` requiere `x-organizer-id`
   - relevante sólo si en el futuro se abre alta de artist desde UI
   - no reabre este bloque porque el panel aceptado no incluye quick-create
