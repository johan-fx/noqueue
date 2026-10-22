# Relevo automático por ausencia

## Operativa

Una asignación autoriza una atención. Si el llamado vence, se caduca y se llama
a un único sustituto, con un nuevo plazo completo desde la llamada real. La
confirmación de llegada sigue siendo manual. Cancelar el llamado, no encontrar
candidato o finalizar la ventana original del servicio termina esa cadena; no
queda disponibilidad pendiente para futuras altas. Cerrar inscripciones no
impide atender la lista existente.

Recepción y piscina seleccionan el primer turno esperando por secuencia/ID.
Restaurante selecciona el primero que cabe en la capacidad originalmente
confirmada y acepta esa zona (o no tiene preferencia). La capacidad no se reduce
si se llama a un grupo menor. No se consulta inventario físico. Sin contexto
confirmado, o si el catálogo ya no lo admite, se requiere asignación manual.

Las sustituciones usan `source=handoff`: no generan intervalos/ratios de
aprendizaje ni mueven el ancla humana. Las previsiones sí se recalculan al cambiar
los turnos esperando, con las protecciones normales del estimador.

## Contratos y transacciones

`assign_next` debe enviar `expectedEntryId` y `expectedVersion` de la cabecera
mostrada. Si mantenimiento u otro operador la consumió, devuelve
`409 assignment_next_changed`: refrescar sin reintento automático. Un comando
nuevo antiguo sin precondición devuelve `409 assignment_precondition_required`.
Los replays idempotentes de éxitos antiguos siguen devolviendo el éxito original.

La migración `0034_arrival_replacement.sql` registra autorización y resultado por
ciclo de llamada, además del enlace al sucesor. No hace backfill. Staff, cesión y
expiración comparten la preparación de llamada. Cada expiración/sustitución,
proyección, evidencia, captura de métricas y outbox se confirman en un solo batch.
Las alarmas del coordinador y la reconciliación existente no necesitan navegador.
La entrega tardía o fallida no amplía el plazo ni revierte la asignación.

Las migraciones de relevo son `0034_arrival_replacement.sql` y
`0035_replacement_decisions.sql`, posteriores a las de privacidad y móvil de
`main` (hasta `0033`). La preparación compartida de llamada y la expiración usan
`lifecycleNoticeStatements`: WhatsApp y push móvil conservan su elegibilidad
independiente y se registran en la misma transacción que el cambio de turno.
Esto también cubre cesiones y sustituciones elegidas por el personal; no añade
notificaciones al personal ni activa ninguno de los canales.

La lectura de personal incluye `automaticReplacement` con origen, elegibilidad,
resultado y sucesor. La interfaz muestra las sustituciones y los motivos por los
que requieren una nueva asignación manual. No hay cambios de estados públicos
ni plantillas de WhatsApp nuevas.

## Validación y publicación

`QUEUE_AUTO_REPLACEMENT_ENABLED` está **deshabilitado** en los perfiles del repo.
Solo las llamadas nuevas con el flag en `true` quedan autorizadas; una llamada
antigua no adquiere autorización por activar el flag. Cesiones y relevos heredan
la autorización y el fin de servicio originales. Deshabilitarlo impide nuevos
relevos, pero sigue caducando turnos y permite operar manualmente.

Validación local (la suite API aplica migraciones únicamente a D1 de prueba):

```sh
pnpm --filter @noqueue/api test
pnpm --filter @noqueue/contracts test
pnpm --filter @noqueue/web test
pnpm check-types
pnpm --filter @noqueue/web lint
NOQUEUE_E2E_AUTO_REPLACEMENT=true pnpm --filter @noqueue/e2e test:e2e specs/arrival-replacement.spec.ts --project=chromium --workers=2
```

El E2E usa Worker/base aislados, proveedores simulados y un plazo real de un
minuto. El flag `NOQUEUE_E2E_AUTO_REPLACEMENT` solo existe en el lanzador local,
no altera las variables de despliegue.

Publicar primero la migración y después API/web compatibles con el flag apagado.
Las pestañas antiguas deben recargar para usar el botón rápido. Validar en staging
con contactos de prueba autorizados antes de habilitar. Supervisar eventos
estructurados `arrival_replacement` por resultado, conflictos de precondición y
el outbox existente (fallidos/desconocidos). El log no incluye datos personales.
Ante incidentes, apagar el flag; no borrar registros ni revertir la migración.
Despliegues, migraciones remotas, activación y mensajes reales requieren
autorización independiente: no se ejecutan como parte de las pruebas locales.

## Restaurant decisions and minimal UI

Migration 0035 adds pending replacement decisions, unique per expired call cycle;
there is no historical backfill. Automatic restaurant replacements require the
same party size, not merely a party that fits. Zone and confirmed capacity are
preserved. Smaller alternatives are ordered by party size descending and then
sequence/id. Choosing a replacement is a handoff (including staff audit), not a
new cadence sample. A chosen party establishes the size for subsequent handoffs.

The staff-only replacement-decisions read is serialized by QueueCoordinator.
resolve_replacement and dismiss_replacement use decision version and idempotency;
resolution also requires the candidate version. Selection is revalidated at commit.
No candidate is reserved; later joins never restart an automatic replacement.
Expiry of the original service window or restoration of the origin retires pending
decisions. Closing admission alone does not retire them. Disabling the feature
blocks assignment through decisions, but allows dismissal and ordinary staff work.

The sheet is shown only inside the affected restaurant list. It does NOT notify
staff with the app closed. Ahora no closes locally for the current list visit;
refreshes do not reopen it and no pending-count text or extra control is added.
Leaving and reopening the list (or reloading) shows unresolved decisions again.
Dismissal or resolution is
shared by all staff. No WhatsApp/push/desktop notifications are sent to staff.
The existing customer ready/expired notifications remain unchanged.

Visual regression (isolated local Worker and fictitious entries):

```sh
NOQUEUE_E2E_AUTO_REPLACEMENT=true REPLACEMENT_SCREENSHOTS="$PWD/reports/replacement-comparison" \
  pnpm --filter @noqueue/e2e test:e2e specs/replacement-screenshots.spec.ts --project=chromium
```

For the main reference, run the same capture spec against a separate copy of main,
with REPLACEMENT_BASELINE=true and without enabling the replacement flag. Never
install, build, migrate, or change files inside another task's main checkout.
