# Asignación automática por servicio

## Configuración y activación

La asignación automática se activa de forma explícita en la configuración de cada
servicio (`automaticAssignmentEnabled`). El valor corresponde al servicio, no al
establecimiento completo. Las configuraciones antiguas sin el campo conservan un
comportamiento seguro: no se consideran habilitadas hasta que un operador lo
active. El flag de entorno `QUEUE_AUTO_REPLACEMENT_ENABLED` sigue siendo el
interruptor global de emergencia; la automatización efectiva requiere tanto el
ajuste del servicio como ese interruptor.

La opción configurada no crea ciclos por sí sola. Cada ciclo comienza con una
asignación manual del maître: la llamada de un turno concreto en Restaurante, o
la acción/CTA de asignación en Recepción y Bar/Piscina. Una activación posterior
del servicio no convierte llamadas históricas o ya activas en ciclos automáticos.
El cliente recibe el aviso de llegada de la forma habitual.

Un cambio de admisión/cutoff solo regula quién puede apuntarse; no cierra la
ventana física del servicio ni detiene ciclos ya iniciados. A la inversa, el
cierre físico de la ventana aplica las reglas de retención descritas abajo, aunque
la automatización esté apagada.

La card y el resumen de configuración indican que el modo está activado. El
footer distingue el modo configurado de la actividad: sin ciclos en curso muestra
el estado pausado y pide una nueva asignación manual; con ciclos activos muestra
el número de asignaciones y comunica que, si vence el plazo, se avisará al
siguiente candidato compatible. El CTA de asignación manual permanece disponible
para iniciar ciclos adicionales en Recepción y Bar/Piscina. En Restaurante, el
maître inicia cada ciclo desde la acción de la card del cliente.

## Ciclos y sustituciones

Cada ciclo mantiene identidad, capacidad inicial, turno actualmente avisado,
plazo, historial de intentos y estado propios. Puede haber varios ciclos activos
simultáneamente, incluso en el mismo servicio.

- Confirmación del maître: completa el turno y detiene solo ese ciclo.
- Cancelación manual del maître: cancela ese turno y detiene solo ese ciclo; no
  avisa a otro candidato. Para reanudar hace falta una nueva asignación manual.
- Cancelación del propio cliente sobre un turno avisado: no equivale a la
  cancelación manual del maître; el ciclo puede avisar automáticamente a otro
  candidato compatible y conserva su capacidad inicial.
- Expiración del plazo: cancela el turno avisado y busca automáticamente al
  siguiente candidato compatible.

En todos los casos, terminar o cambiar un ciclo no detiene los otros ciclos del
servicio.

### Restaurante

La capacidad del ciclo es el número de comensales del turno asignado manualmente,
no la capacidad sobrante de la mesa. Al expirar un aviso sin confirmación, la
búsqueda intenta primero un grupo del tamaño de la capacidad inicial y después
desciende por cada tamaño hasta una persona. Dentro de cada tamaño se elige por
orden de espera `(sequence, id)`, más antiguo primero. Nunca se llama
automáticamente a un grupo mayor que la capacidad inicial. Una sustitución menor
no reduce esa capacidad raíz para los siguientes intentos del mismo ciclo. Se
mantienen los requisitos de contexto confirmado y compatibilidad de zona/catálogo
que ya restringen la asignación de Restaurante.
Si existe una alternativa compatible tras la expiración, el sistema la llama
automáticamente, sin pedir una elección manual.

Si no hay candidato compatible, el ciclo se detiene y el maître debe iniciar uno
nuevo con una asignación manual. No se reserva capacidad ni queda una búsqueda
latente para nuevas altas. El mismo criterio de parada se aplica si falta el
contexto de mesa confirmado o el servicio ya no permite mantener el ciclo.

### Aviso de asignación manual pendiente (Restaurante)

Cuando un plazo vence con resultado `no_candidate` y quedan turnos vigentes en
espera, la transición guarda una incidencia por ciclo en
`queue_automation_attention` (migración aditiva `0040`, sin backfill). No se crea
para una cola vacía, un reemplazo exitoso ni un ciclo deshabilitado. El snapshot
`automation.attention` la devuelve también sin cursor: no depende del feed de
toasts ni desaparece al reconectar. No guarda nombres en claro.

El sheet «No hay un turno compatible» reutiliza el marco, alert ámbar y filas de
asignación existentes. Muestra el turno cuyo plazo venció, la referencia y los
turnos pendientes para una **nueva** asignación, no sustitutos del ciclo anterior.
Solo se abre cuando la lista está visible y no hay otra hoja/operación en curso;
varias incidencias se agrupan en una hoja con selección de la referencia.
«Ahora no» conserva la incidencia y deja «Asignación manual pendiente · Revisar»;
la card del servicio indica «Requiere revisión». El navegador recuerda qué
incidencias presentó para evitar reaperturas en cada polling/recarga. Ese estado
local no resuelve la incidencia del servidor.

«Asignar» prepara el flujo manual; solo «Confirmar» ejecuta `call` con el
`attentionId` de la incidencia. La resolución y la nueva llamada se confirman en
la misma transacción, con los controles de versión, idempotencia, permisos,
cola y seating existentes. Una incidencia ya atendida por otro operador rechaza
una segunda asignación vinculada con `automation_attention_resolved`. El ciclo
original permanece parado; el nuevo toma la capacidad del nuevo grupo. Los demás
ciclos continúan sin cambios.

La incidencia también se resuelve permanentemente si deja de haber demanda
vigente, termina su ventana física o se cierra explícitamente el servicio. Una
nueva alta no la resucita. El cierre de la hoja nunca asigna, notifica al cliente
ni cambia capacidad. La migración debe aplicarse antes de desplegar API/web; este
cambio no implica ejecutar ningún despliegue.

### Recepción y Bar/Piscina

El ciclo empieza igualmente con una asignación manual. En Recepción pueden
coexistir ciclos de Check-in, Check-out y otros servicios. Un reemplazo de
Recepción debe pertenecer al mismo subtipo (`check_in`, `check_out` u `other`);
se elige por FIFO `(sequence, id)`. En Bar/Piscina se usa FIFO `(sequence, id)`.
Confirmar o cancelar manualmente detiene únicamente el ciclo afectado; ambas
acciones también están disponibles mediante swipe.

### Cesión de turno (todos los servicios)

Cuando el cliente cede un turno en espera, este vuelve a espera sin iniciar una
asignación. Si cede un turno ya llamado que no pertenece a un ciclo activo,
también vuelve a espera, sin handoff automático. Si el turno llamado pertenece a
un ciclo, el propio turno cedido se excluye y se busca un sustituto compatible;
se respeta FIFO `(sequence, id)`: si el sustituto esperaba después del turno
cedido, se intercambian sus posiciones para ocupar la posición liberada; si ya
esperaba antes, conserva su lugar. Sin candidato compatible, el ciclo se detiene
y no queda una búsqueda latente. La cesión no altera la capacidad inicial ni
reactiva ciclos detenidos.

### Pasar turno y priorizar

El personal puede pasar un turno en espera sin iniciar una asignación: el turno
intercambia su posición con el siguiente candidato compatible que esperaba detrás.
Si no existe tal candidato, la acción se rechaza y no cambia estado ni orden.
Pasar un turno ya avisado dentro de un ciclo activo transfiere el aviso al
siguiente candidato compatible y devuelve el turno anterior a espera en el hueco
que ocupaba el sucesor. Si no hay sucesor compatible, el turno avisado vuelve a
espera en su posición original, el ciclo se detiene y no se llama a nadie.
Pasar un turno no es cancelar ni confirmar la llegada.

Priorizar un turno en espera otorga prioridad explícita de un solo uso: entre los
candidatos compatibles, las prioridades pendientes se atienden antes del orden
normal por tamaño/cola, manteniendo FIFO entre turnos priorizados. Solo consume
la prioridad cuando una asignación manual o automática selecciona a ese candidato;
no afecta a turnos ya avisados ni permite saltarse los requisitos de capacidad,
subtipo de Recepción o compatibilidad del servicio. Abrir y cerrar una hoja de
confirmación no ejecuta el comando. En la hoja de candidatos más antiguos, solo
el turno seleccionado se asigna al pulsar «Confirmar»; los demás no cambian.

Los toasts de personal usan el feedback de Producto y el cursor de eventos por
lista. Al abrir la lista y al volver de una desconexión/enfoque en primer plano,
el cliente solicita un nuevo baseline sin `after`; el servidor devuelve el
high-water mark actual y cero eventos. Así no reaparecen ni feedback ya consumido
ni eventos generados mientras el cliente estaba desconectado.

## Cierre físico y turnos retenidos

Al terminar físicamente una ventana de servicio, los turnos que siguen esperando
no se cancelan en masa ni se notifican como cancelados: quedan retenidos para
gestión manual y marcados `manual_only`, tanto si la asignación automática estaba
activada como si no. Siguen visibles al personal y el cliente puede cancelar su
propio turno, pero no se les calcula ETA ni se emiten avisos de acercamiento; no
cuentan como demanda vigente para previsiones, cupo público o capacidad de la
lista. El coordinador tampoco programa alarmas vencidas para esos turnos.

Una llamada manual de un turno retenido fuera de una ventana física abierta sigue
siendo manual y no inicia un ciclo. Si el maître lo llama dentro de una ventana
actual abierta, esa acción explícita lo reancla a la ventana actual y solo ese
turno puede iniciar un ciclo si ambos flags de automatización están activos. La
activación global o por servicio nunca convierte automáticamente otros turnos
retenidos en candidatos ni revierte el `manual_only`.

## Estado, persistencia y compatibilidad

La migración `0036_automation_cycles.sql` es aditiva: registra la identidad y
estado del ciclo por servicio, el turno inicial y actual, capacidad, subtipo de
Recepción, contexto de mesa y vínculo con cada intento de llamada. No hace
backfill: una llamada histórica no recibe autorización para sustituciones. El
campo `cause` distingue expiración automática de acciones/cancelaciones humanas
sin reinterpretar el `origin` histórico. Las entradas que requieren asignación
manual se marcan explícitamente para evitar que una expiración posterior las
incorpore a un ciclo automático antiguo.

La expiración conserva el límite de llegada del sucesor desde el momento en que
se realiza la llamada; la cancelación manual del maître no avisa a otro candidato.
La cancelación del cliente sobre un turno activo sí puede disparar la búsqueda de
sustituto del ciclo. La transición, el historial, los eventos de cola, las
proyecciones y los avisos del cliente se confirman juntos. Las reejecuciones de alarmas y comandos deben ser
idempotentes; una carrera de expiración con llegada/cancelación no debe avisar ni
llamar dos veces. Las muestras de asignación automática no alteran el ancla de
aprendizaje humano.

Desactivar la opción del servicio o el kill switch global no revoca el turno ya
avisado ni cambia su plazo de llegada; bloquea nuevas sustituciones automáticas.
Volver a activarla no resucita ciclos detenidos ni retoma intentos antiguos: hace
falta una nueva asignación manual para iniciar otro ciclo.

La migración `0037_staff_queue_interactions.sql` conserva ciclos e intentos
anteriores y añade prioridad consumible por turno, su índice FIFO y el registro
durable `queue_staff_event` con cursor por lista. No crea eventos de feedback
para acciones históricas; el baseline inicial o tras reconexión avanza el cursor
al high-water actual y no reproduce eventos anteriores ni los ocurridos offline.
Las prioridades preexistentes empiezan sin valor
(`NULL`) y el contador del servicio en cero; la migración no reordena ni prioriza
turnos antiguos.

Los resultados idempotentes de comandos de personal conservan el `operationId`
y los datos de la operación, pero nunca guardan nombres (`displayName: null` en
el JSON persistido). Al repetir un comando autorizado, el servidor rehidrata el
nombre vigente desde la entrada de la misma cola; si la entrada o su cipher ya
faltan por borrado o anonimización, responde con la identidad y `displayName: null`,
sin convertir un replay válido en un 404. Un cipher presente pero
inválido o no descifrable sigue fallando de forma cerrada. Así se mantiene
estable el resultado de la operación sin retener PII en el registro durable.

## Validación local

El E2E usa un Worker y una base locales aislados, proveedores simulados y plazos
reales abreviados. La variable `NOQUEUE_E2E_AUTO_REPLACEMENT` activa únicamente el
kill switch del Worker aislado del lanzador local; los escenarios activan el modo
explícitamente en el servicio bajo prueba.

```sh
pnpm --filter @noqueue/api exec vitest run src/features/queue/arrival-replacement.test.ts
pnpm test:production
pnpm --filter @noqueue/contracts test
pnpm --filter @noqueue/web test
pnpm check-types
NOQUEUE_E2E_AUTO_REPLACEMENT=true pnpm --filter @noqueue/e2e test:e2e specs/arrival-replacement.spec.ts specs/assignment-seating.spec.ts specs/staff.spec.ts specs/queue-swipe.spec.ts specs/queue-services.spec.ts --project=chromium --workers=1
NOQUEUE_E2E_AUTO_REPLACEMENT=true pnpm --filter @noqueue/e2e test:e2e specs/queue-services.spec.ts specs/queue-swipe.spec.ts --project=chromium --workers=1
NOQUEUE_E2E_AUTO_REPLACEMENT=true REPLACEMENT_SCREENSHOTS=/tmp/noqueue-staff-feedback-final3-20261022 pnpm --filter @noqueue/e2e test:e2e specs/replacement-screenshots.spec.ts --project=chromium --workers=1
NOQUEUE_E2E_AUTO_REPLACEMENT=true REPLACEMENT_SCREENSHOTS=/tmp/noqueue-staff-feedback-final3-20261022 pnpm --filter @noqueue/e2e test:e2e specs/replacement-screenshots.spec.ts --project=chromium --workers=1 --grep 'captures older compatible selection and stale conflict Figma states in mobile and desktop viewports'
QUEUE_DEMO_DIR=/tmp/noqueue-ui-countdowns-final-20261022 NOQUEUE_E2E_AUTO_REPLACEMENT=true pnpm --filter @noqueue/e2e exec playwright test --config ui-countdown-demo.config.ts --project=queue-demo --workers=1
pnpm test:queue
```

`pnpm test:queue` utiliza el perfil estándar, sin las suites opt-in de ciclos y
capturas. Los perfiles estándar y extendido mantienen el flag E2E apagado, con
independencia de las variables exportadas por la shell. Para las suites opt-in,
utilizar el perfil completo o los comandos Playwright explícitos anteriores.

### Perfil completo de CI

`node scripts/queue-verification/run.mjs --all` habilita automáticamente los ciclos
solo en el Worker E2E aislado y ejecuta las suites de capturas, además del resto de
regresiones. Guarda las capturas en `cycle-screenshots/<navegador>/` dentro del
informe para no sobrescribir evidencia entre Chromium, Firefox y WebKit. El
veredicto sigue rechazando pruebas omitidas, flaky o sin evidencia; no se filtran
los escenarios opt-in. Este perfil no modifica el flag de producción ni despliega.


La suite de producción verifica que la consulta de snapshot de backup conserva
headroom bajo 90.000 bytes y sigue fallando de forma segura si supera 95.000; no
se debe ampliar ni relajar esa guarda para acomodar una migración. También prueba
una actualización poblada de 0035 a 0036 sin pérdida de historial ni backfill de
ciclos, y una actualización de 0036 a 0037 que conserva ciclos activos/terminales
e intentos enlazados sin crear eventos históricos de feedback. Se comprueba que
el query snapshot conserve al menos 5 kB de margen bajo el límite duro de 95.000
bytes; no se divide un snapshot en vivo ni se relaja el límite. Las migraciones
nuevas deben validarse con `pnpm test:production` antes del rollout.

### Evidencia local (22/10/2026)

- `pnpm test:production`: PASS, 49/49. La consulta de snapshot midió 88.251 bytes,
  bajo el objetivo de 90.000 y con 6.749 bytes de margen frente al límite duro
  de 95.000; las regresiones cubren una actualización poblada 0035→0036 y la
  preservación de ciclos/reemplazos en 0036→0037.
- API final: 901/901 pruebas; herramientas API 15/15; contratos 94/94.
- Web: 816/816 pruebas. Typecheck y lint global terminaron correctamente (6
  tareas cada uno); lint conservó dos warnings preexistentes.
- E2E funcional focalizado, Chromium, 1 worker: la ejecución combinada tuvo
  20/26 PASS; los 6 fallos restantes fueron expectativas de test anteriores a
  las hojas/gestos nuevos en `queue-services` y `queue-swipe`. Tras actualizarlas,
  la ejecución dirigida de esos dos specs terminó 6/6 PASS. En la ejecución
  combinada ya pasaron 8/8 casos de `arrival-replacement`, 2/2 de
  `assignment-seating` y 10/10 de `staff`; considerados ambos lotes, los 26
  casos únicos focalizados pasan.
- Capturas Figma: `replacement-screenshots.spec.ts` 4/4 PASS. Se capturaron los
  13 estados aprobados en viewports Chromium móvil 390×844 y desktop 1440×1000
  (26 PNGs) en
  `/tmp/noqueue-staff-feedback-final3-20261022`. Incluye una expiración real y
  conflicto de llegada por snapshot obsoleto; no se sustituyó por un conflicto
  manual genérico. Durante la revisión se detectó que una captura duplicada
  sobrescribía el estado de alternativas antiguas después de seleccionarlas; se
  añadió una guardia contra capturas duplicadas y se regeneró específicamente
  Figma `1826:37166` en una ejecución enfocada 1/1 PASS. La ruta final refleja el
  warning anterior a confirmar la selección. Tras la revisión visual, el aviso
  se ajustó a ámbar, se eliminó el copy redundante y se dejó el footer fuera del
  scroll del contenido. El spec enfocado se volvió a ejecutar 1/1 PASS con una
  aserción adicional de que «Confirmar» cabe entero en el viewport móvil de
  390×844; se regeneraron ambos PNG de `37166` en la misma ruta. La revisión
  visual confirmó que el warning ámbar aparece una sola vez y que «Confirmar» y
  «Volver» quedan visibles en móvil y desktop; esto no constituye una garantía
  de equivalencia píxel a píxel.
- Countdown visual: `ui-countdowns.spec.ts` 1/1 PASS (Chromium móvil, 1 worker;
  configuración `ui-countdown-demo.config.ts`).
- `pnpm test:queue`: PASS. Harness 14/14, API Vitest 33 archivos / 495 tests y
  navegador Playwright Chromium 9/9; reporte local:
  `queue-reports/2026-10-22T21-34-34.673Z-79497/index.html`.
- Mobile unit/static: 47/47 PASS. Validación nativa pendiente: Chromium en
  viewports no sustituye pruebas de WebView/dispositivo. No se ejecutó despliegue
  ni migración remota.

### Revisión de integración (23/10/2026)

- Revalidación local: API 903/903 + herramientas 15/15, web 819/819,
  producción 51/51, tipos y lint correctos (dos warnings preexistentes).
  E2E focalizados 26/26 y capturas Figma 4/4 tras los ajustes de accesibilidad.

- `0038_automation_history_cleanup.sql` añade un trigger anterior al borrado de
  un ciclo que limpia solo su enlace opcional en el historial de llamadas. Evita
  un fallo de clave foránea durante la limpieza por privacidad si otro intento
  del ciclo sigue existiendo; no reescribe 0036/0037, no modifica turnos ni
  reanima automatización. La regresión reproduce el fallo anterior y comprueba
  el borrado de origen/sucesor y la restauración del backup.
- La UI de turnos retenidos no muestra una posición ficticia. Las tarjetas
  mantienen sus datos accesibles fuera del botón de gestión y describen el
  estado/contador/intento al enfocar el control.
- El experimento aislado utiliza el mismo orden efectivo de prioridades y
  exclusión de retenidos al avanzar, leer posiciones y emitir avisos.
- La configuración de producción declara el interruptor global explícitamente
  apagado y el preflight rechaza activarlo en el perfil de entrega actual. La
  allowlist de instalación incluye `esbuild`/`workerd` para sus binarios nativos
  de Wrangler/pruebas Worker y `sharp` 0.32 para libvips en `@capacitor/assets`;
  no se habilita el script opcional de MSW.
- Se conserva la asignación explícita por tarjeta para los tres tipos de
  servicio. No se infiere el siguiente candidato desde una lista potencialmente
  truncada si falla la lectura autoritativa de automatización.

## Rollout y rollback

Aplicar primero las migraciones aditivas 0036, 0037, 0038 y 0040 y desplegar después API y web compatibles,
manteniendo apagado el kill switch global. En staging, habilitar el ajuste en un
servicio de prueba y verificar el inicio manual, varios ciclos simultáneos,
expiración, cancelación, llegada, no-candidatos y avisos/outbox. Confirmar que un
servicio con el ajuste apagado no inicia ciclos aunque otro del establecimiento
esté activado. Solo después de validar se puede autorizar por separado la
activación del kill switch donde corresponda.

Supervisar los eventos estructurados de ciclo y expiración, estados terminales,
conflictos de versión, fallos del outbox y el número de ciclos activos. Ante un
incidente, apagar el kill switch global; no borrar historiales ni revertir la
migración. No se ejecutan despliegues, migraciones remotas, activación de flags ni
mensajes reales como parte de las pruebas locales.

### Verificación remota del sheet en staging (26/10/2026)

Despliegue autorizado **solo en staging**, Worker
`e44a67d3-8948-4585-bc77-39c2a4aa42b1`, tras aplicar únicamente la migración
pendiente `0040_automation_attention.sql`. Salud, rutas SPA, hashes de assets y
claves foráneas comprobados. Todos los bindings previos se conservaron, con
automatización global activa y WhatsApp apagado; no se modificó producción.

En un servicio QA separado de Snack bar se reprodujo el plazo real de un minuto:
Pepe QA (2) expiró, Alberto QA (4) quedó esperando y el sheet apareció sin
intervención. «Ahora no» y la recarga conservaron la incidencia sin reabrirla;
«Revisar» la recuperó. «Asignar» no llamó al cliente antes de «Confirmar». La
confirmación resolvió la incidencia y creó un ciclo nuevo de capacidad 4,
conservando el original de capacidad 2 detenido por `no_candidate`.

Los dos turnos sintéticos tenían `whatsapp_suppressed=1` y generaron cero
notificaciones en el outbox. Al terminar, el turno de Alberto quedó completado,
sin ciclos ni incidencias pendientes y con la lista QA pausada. No se borraron
historiales ni se alteró el servicio real Snack bar. Esta comprobación web no
sustituye una validación nativa ni autoriza un despliegue a producción.

## Referencias visuales de Producto

- Configuración, switch de activación: Figma `1800:31691`.
- Badge del título de card: Figma `1571:13815`.
- Badge del resumen de configuración: Figma `1330:6439`.
- Footer Restaurante al inicio y durante ciclo: Figma `1826:35576` y
  `1826:36159`.
- Footer Recepción / Bar-Piscina al inicio y durante ciclo: Figma `1854:32580` y
  `1854:32978`.
- Sheets/cards de siguiente turno, llamada, cancelación, pasar turno, alternativas
  antiguas, prioridad y conflicto; toasts de asignación, cancelación, pase,
  prioridad y expiración: Figma `1826:35806`, `1826:36227`, `1826:37115`,
  `1822:34635`, `1822:34669`, `1826:36886`, `1826:37281`, `1822:34572`,
  `1826:37166`, `1822:34597`, `1826:37158`, `1822:34622` y `1861:33817`.

Los footers muestran la actividad del servicio (ciclos activos), no cambian la
configuración del switch. Las capturas por sí solas no prueban la selección de
candidatos ni el aislamiento entre ciclos; esas reglas se validan en los
contratos y pruebas de comportamiento.

### Inventario visual del ciclo (23/10/2026)

El [PDF de estados y escenarios](../../output/pdf/noqueue-inventario-visual-ciclos.pdf)
contiene 32 páginas organizadas por Restaurante, Recepción y Bar/Piscina, con
54 colocaciones de capturas y descripciones de fases, sheets, toasts, prioridades,
ciclos simultáneos, conflictos y motivos de parada. Distingue las capturas E2E
integradas del 22/10 de las capturas de UI con respuestas API controladas del
23/10; todas usan datos ficticios. No acredita activación en producción ni
sustituye la validación nativa WebView/Capacitor pendiente.

### CI paralelo y guardas de integración

El workflow ejecuta checks rápidos, API/harness, build, Chromium, Firefox, WebKit,
producción/privacidad/PWA y Android en jobs independientes. Cada navegador conserva
un solo worker, una base efímera propia, todos sus tests y cero reintentos en la
suite de cola. No se recortan pruebas ni se mueven regresiones obligatorias fuera
de la PR. Las suites PWA conservan sus proyectos y su política de reintentos previa.

- Imagen Playwright `v1.63.0-noble`, contrastada con el lockfile: navegadores y
  dependencias del sistema preinstalados, sin `apt` en cada validación.
- Compilación general reutilizada por E2E, PWA y Android; compilación de producción
  OFF archivada por separado. Manifiestos verifican SHA, perfil y hash de los
  archivos antes de usarlos. Los navegadores no reconstruyen ni mutan esos assets.
- `verify` depende de **todos** los jobs y rechaza fallos, cancelaciones u omisiones.
  Combina los cuatro informes API/navegadores del mismo SHA y compara los tests
  ejecutados contra el inventario completo de `playwright --list`, además de
  conservar el veredicto estricto de evidencia, cobertura Q-* por motor y límite
  de backup de 95.000 bytes. Un informe incompleto nunca da verde.
- Los nuevos commits cancelan automáticamente runs obsoletos de su PR, no los de
  `main`. Artefactos distintos por bloque y `overwrite` permiten reejecutar un job
  del mismo commit sin colisiones. La integración sigue esperando todos los checks.

La ejecución local monolítica sigue disponible: `pnpm test:queue` y
`node scripts/queue-verification/run.mjs --all`. La paralelización no introduce
ningún despliegue, proveedor real ni activación remota.
