# Auditoría de inputs Android — 26/10/2026

## Resultado y alcance

Reporte de Alberto: no puede cambiar «Hasta» en configuración de restaurante desde navegador Android.

Se reforzó `apps/web/src/components/shadcn-studio/date-picker/date-picker-09.tsx`:
- Mantiene `Input` y `Label` shadcn/Base UI. Sin dependencias nuevas.
- Conserva `type=time`, `step=60`, etiquetas y valor `HH:mm`.
- Elimina ocultación de `::-webkit-calendar-picker-indicator`, `appearance-none` y personalización de segmentos internos.
- Solicita `showPicker()` durante el click del usuario. Si falta o lanza excepción, no cancela el evento y mantiene la edición/indicador nativo.
- No abre el picker durante `focus`: navegar con teclado no lo abre automáticamente.

**No se reprodujo el fallo original de Alberto**: el original también abrió el picker en este emulador. La corrección elimina una personalización frágil y añade apertura explícita; no demuestra que el CSS fuera la causa en su dispositivo. Falta navegador/versión exactos y repetir en ese entorno.

## Evidencia ejecutada

- AVD `noqueue-api36`: Android 16 / API 36, Chrome 133.0.6943.137, 1080×2400, DPR 2.625.
- No es un perfil móvil de navegador desktop: Chrome corre dentro de Android y el diálogo se maneja con ADB/UI Automator.
- Fixture monta **ServiceConfigDrawer real**, con sus componentes, estilos y validaciones; datos sintéticos Snack bar. Guardado interceptado en onSave y localStorage. Sin API, credenciales, notificaciones ni escrituras en staging.
- Toque abre Hasta → dial nativo cambia 23:00 a 22:30 → Set → resumen 12:00–22:30 → Confirmar → onSave recibe 22:30 → recarga conserva 22:30.
- Toque abre Desde → Cancel mantiene 12:00.
- Capacidad: teclado Android visible (`mInputShown=true`, `mIsInputViewShown=true`). Vaciar el campo produce **0**, no cadena vacía; sustituir por 10 funciona. Es una fricción de edición confirmada, no un bloqueo del teclado.
- 27 tests pasan (TimeInput, ScheduleGroupsEditor y ServiceConfigDrawer), typecheck y lint de archivos modificados pasan.
- El emulador está en inglés/12h: puede mostrar 10:30 PM aunque el valor guardado sea 22:30. El idioma/formato del diálogo nativo lo gestiona Android/navegador.

Artefactos locales (reports está ignorado por Git):
- `reports/android-inputs/after-picker.png`: selector Android abierto.
- `reports/android-inputs/after-saved.png`: formulario con hora modificada.
- `reports/android-inputs/number-keyboard.png`: teclado numérico abierto.
- `reports/android-inputs/android-result.json`: resultados reproducibles.
- `reports/android-inputs/inventory.json`: inventario completo generado.

No certificados: Samsung Internet, navegador integrado/Custom Tab de Alberto, Chrome actualizado, móvil físico, Safari/iOS, persistencia en backend staging. No se ha desplegado.

## Inventario principal y riesgos

El script AST encuentra **83 sitios JSX**, incluyendo definiciones de componentes, bucles y propiedades dinámicas. No es el número de campos visibles. El conteo no cubre automáticamente campos internos de librerías ni sustituye navegar todos los flujos.

| Familia | Ubicaciones principales en apps/web/src | Resultado / riesgo | Prioridad siguiente |
|---|---|---|---|
| Hora compartida | components/shadcn-studio/date-picker/date-picker-09.tsx; features/staff/service-config/ScheduleGroupsEditor.tsx | Apertura, cambio, cancelación y entrega de valor al guardado verificados en Android. Corrección aplicada. | Repetir en navegador exacto de Alberto |
| Otras horas nativas | features/staff/ServiceForm.tsx (2 sitios); features/staff/QueueAdvancedDrawer.tsx (2) | Usan Input type=time directo; no tenían la ocultación del indicador. No reciben el nuevo handler compartido. Sin prueba Android de esos flujos. | Unificar interacción y probar cada flujo, preservando register/ref/min/max |
| Capacidad numérica | features/staff/service-config/CapacityStep.tsx | Android abre teclado. `Number('')` convierte borrar en 0 inmediatamente (confirmado). No impide reemplazar, pero dificulta edición intermedia. | Mantener borrador vacío hasta blur/validación; no corregido en este cambio |
| Duraciones por grupo | features/staff/service-config/QueueConfigForm.tsx | También convierte con `Number(event.target.value)`; mismo riesgo estático de vacío→0. | Probar borrado, 0, límites y reemplazo |
| Otros números | service-config/QueueStep.tsx, QueueConfigForm.tsx, ServiceForm.tsx; QueueEntryForm.tsx, ManualQueueEntryForm.tsx; join-queue/web/DemoQueue.tsx | valueAsNumber puede producir NaN al vaciar. No prueba por sí mismo un bug. Sin inputMode explícito; type=number ya comunica semántica numérica. | Probar estado vacío, límites y validación con teclado real |
| Texto y búsquedas | service-config/GeneralStep.tsx, AddSpaceStep.tsx; auth/Login.tsx; staff/Commercial.tsx, CreateEstablishmentDrawer.tsx, MemberActionDrawer.tsx | No se encontró inputMode=none ni bloqueo general de foco en las búsquedas estáticas realizadas. Usuario/email del login es texto deliberadamente, admite ambos. | Teclado, autocompletado, scroll y footer con teclado abierto |
| Teléfono + país | components/ui/phone-input.tsx; staff/ManualQueueEntryForm.tsx; customer/PublicWhatsAppConsentFields.tsx | Componente compartido declara type=tel e inputMode=tel; buscador de país en popup. No probado en Android en esta sesión. | Teclado, prefijo, búsqueda y popup dentro de drawer |
| Contraseñas | auth/Login.tsx; staff/CreateEstablishmentDrawer.tsx, MemberActionDrawer.tsx | Tipo dinámico texto/password y botón mostrar/ocultar. | Retención de foco, teclado y autocompletado |
| Select/Choice/Combobox | components/ui/select.tsx, combobox.tsx; configuración de servicios, alta de clientes, filtros | No requieren teclado salvo buscadores. Riesgo de popup/scroll/portales, no mismo CSS de hora. | Selección táctil y cierre dentro de drawers anidados |
| Switch/Checkbox/ToggleGroup/RadioGroup | ScheduleGroupsEditor.tsx, QueueStep.tsx, PreferenceStep.tsx y otros formularios | Controles táctiles sin teclado por diseño. | Estado, etiquetas y objetivos táctiles |
| Nombre de espacio de solo lectura | service-config/CapacityStep.tsx | `readOnly` explícito, no fallo Android. Parece un input editable visualmente. | Valorar presentación no editable más clara |
| Archivo de logotipo | features/staff/VenueLogoUpload.tsx; hooks/use-file-upload.ts | Input oculto accesible con type=file inyectado por getInputProps; apertura mediante gesto del usuario. | Galería/documentos, cancelar, formatos/tamaño y preview en Android |
| Textarea | components/ui/textarea.tsx, input-group.tsx | Definiciones compartidas; el escáner también cuenta primitivas internas. | Validar cuando existan usos visibles; no atribuir a pantallas no comprobadas |

Conteo por etiqueta: Input 39; Select 11; Choice 6; Switch 6; ToggleGroup 4; TimeInput 2; PhoneInput 2; PasswordField 2; RadioGroup 2; ComboboxInput 2; ComboboxPrimitive.Input 2; InputGroupInput 1; Checkbox 1; Textarea 1; textarea 1; input 1.

## Reproducir

Desde la raíz del repositorio (no apuntar a staging):

```sh
mkdir -p reports/android-inputs
node scripts/qa/inventory-inputs.mjs > reports/android-inputs/inventory.json
pnpm --dir apps/web exec vite tests/android-inputs --config vite.config.ts --host 127.0.0.1 --port 5178
```

En otra terminal, arrancar AVD y Chrome (completar primer inicio sin cuenta si aparece):

```sh
export ADB="$HOME/Library/Android/sdk/platform-tools/adb"
export ANDROID_SERIAL=emulator-5554
"$HOME/Library/Android/sdk/emulator/emulator" -avd noqueue-api36 -no-snapshot-save -no-audio
"$ADB" -s "$ANDROID_SERIAL" reverse tcp:5178 tcp:5178
"$ADB" -s "$ANDROID_SERIAL" shell am start -a android.intent.action.VIEW -d http://127.0.0.1:5178 com.android.chrome
"$ADB" -s "$ANDROID_SERIAL" forward tcp:9223 localabstract:chrome_devtools_remote
node tests/e2e/scripts/android-inputs.mjs
```

El runner requiere Chrome con diálogo nativo en inglés/12h (selecciona 10 PM, 30 minutos, Set/Cancel). No asigna directamente el valor de hora con fill; toca el campo vía CDP de Android y maneja el dial mediante ADB. Espera hit-testing/estabilidad del drawer antes de tocar y el valor tras cerrar el diálogo. Cambiar idioma/formato requiere adaptar selectores nativos. La persistencia comprobada es la del fixture, no backend.

Referencias: [shadcn Date/Time](https://ui.shadcn.com/docs/components/base/calendar), [showPicker y gesto de usuario](https://developer.chrome.com/blog/show-picker/), [Android vs emulación desktop en Playwright](https://playwright.dev/docs/api/class-android).

## Seguimiento — 27/10/2026: números vacíos y unificación

- Añadido `components/ui/number-input.tsx`, construido sobre Input shadcn. Un número vacío/inválido se representa como NaN en el borrador (igual que valueAsNumber de RHF) y como cadena vacía en el DOM. Nunca se convierte en 0 ni se recupera silenciosamente el valor previo. No se guarda sin pasar el esquema.
- Migrados capacidad, minutos por grupo, alta de clientes y alta manual. Los botones +/- del alta manual permiten recuperar un borrador vacío empezando en 1. Los inputs RHF no controlados que ya aceptaban vacío no necesitan este wrapper.
- Se traduce el error de borrador numérico inválido a «Introduce un número válido».
- Los otros cuatro campos de hora ya usan TimeInput: Desde/Hasta del ServiceForm mediante Controller, y hora diaria/por intervalo del recordatorio. Se conservan name/ref/onBlur, disabled, etiquetas y soporte min/max.
- Inventario actualizado: 83 sitios JSX; Input 32, NumberInput 4, TimeInput 5 (el sitio del formulario heredado se expande en un bucle a Desde/Hasta). Solo el componente compartido contiene type=time.
- Suite web completa: 960 tests en 88 archivos, todos pasan. Build y lint de cambios pasan.
- El runner Android amplía la cobertura a borrar mediante ADB/IME, validar vacío, reemplazar y guardar capacidad/minutos, y seleccionar/guardar las cuatro horas migradas con el dial nativo. Las peticiones del recordatorio se interceptan en el fixture; no se envían a staging.
- Para el deploy staging autorizado se compararon bindings y variables con la versión remota. El identificador de teléfono de 360dialog estaba vacío en el fichero local: se usa configuración temporal conservando valores remotos, sin alterar secretos, bindings ni habilitar WhatsApp.

Las observaciones de la primera auditoría sobre cero al borrar y horas sin unificar son históricas y quedan resueltas por este seguimiento. El reporte `android-result.json` registra la última ejecución completa del runner; no confundir una ejecución parcial con un resultado aprobado. Continúa pendiente validar el dispositivo/navegador exacto de Alberto y Samsung Internet.

### Despliegue staging confirmado

- Versión publicada: `5d8ba21e-0e2d-4b35-a7bd-363a8cf8d1a1` (27/10/2026, Europe/Madrid).
- Versión anterior: `e44a67d3-8948-4585-bc77-39c2a4aa42b1`.
- Gate previo completo: 11 comprobaciones Android; 960 tests web; build, typecheck (incluido fixture) y lint de cambios.
- Config temporal de publicación eliminada tras uso; no cambios de configuración persistentes, migraciones ni despliegue a producción.
- Verificación posterior: bindings/variables no-assets idénticos a la versión anterior; `/api/v1/health` responde OK; HTML remoto referencia el mismo bundle local `index-DoQS8MhZ.js`; acceso `/staff` HTTP 200 y formulario de login visible en Chrome Android. No se editó información real de establecimientos durante el smoke.

### Samsung Internet — pendiente por descarga (27/10/2026)

El usuario autorizó instalar el APK de Uptodown únicamente en el emulador de pruebas, sin cuentas ni datos reales. Samsung Internet sigue **sin instalar y sin validar**:

- Google Play del emulador no ofrece actividad de instalación utilizable.
- Los botones de descarga de Uptodown para 31.0.0.64 y 30.0.5.27 no entregaron un archivo en el navegador automatizado (esperas de descarga agotadas, hasta 60 s).
- La petición de descarga de la página mediante CLI con red habilitada devolvió HTTP 404.
- No se ha obtenido APK: no se ha podido comprobar firma ni ejecutar pruebas Samsung. Las capturas existentes son de Chrome, no Samsung.

Para continuar hace falta un APK local verificable o acceso a un dispositivo con Samsung Internet instalado. Capturas pendientes: hora/número antes de editar, selector/teclado de hora y teclado numérico; verificar edición, borrado y guardado.

### Safari iOS — prueba manual real en simulador (27/10/2026)

El usuario da por suficiente Chrome en el emulador Android y no requiere continuar con Samsung. Se abrió Safari en `NoQueue iOS local`, iOS 27.0, UDID `F0DF57A2-69C9-471A-BCCB-1610F9917137`, usando el fixture local con componentes reales (sin datos remotos).

Resultados observados mediante Device Hub:
- Hasta: toque abre selector nativo de ruedas; 23:00 → 22:00, confirmado y visible en resumen.
- Mesas: teclado iOS visible; borrar 10 deja el campo realmente vacío, no 0; escribir 24 funciona.
- Confirmar el wizard muestra `spaces[].tables: 24` en la salida de guardado local. No prueba de API ni de persistencia remota.
- **Incidencias visuales pendientes**: solapamiento horizontal de inputs de hora con el botón de borrar; zoom automático al enfocar el numérico que recorta encabezado/márgenes. No se declara aprobado todo iOS.
- Ensayo local min-w-0/max-w-full no mostró mejora y fue retirado; ningún cambio adicional de aplicación conservado ni desplegado.
- No se ejecutó aún la matriz completa de formularios heredados/recordatorios ni una prueba de recarga de datos en iOS.

Evidencia en `reports/ios-inputs/`: `before-layout.png`, `time-picker.png`, `time-edited.png`, `number-before.png`, `number-empty-keyboard.png`, `saved-number.png`.

Entorno: Xcode de esta máquina gestiona los simuladores mediante Device Hub (`com.apple.dt.Devices`); no existe Simulator.app en la ruta histórica. Usar CUA Device Hub y seleccionar el simulador, nunca el iPhone físico del usuario.

### Corrección iOS y regresión multiplataforma (27/10/2026)

- `TimeInput`: contenedores min-width:0 y caja explícita width/max-width100%, min-width0, border-box. En iOS, appearance:none solo normaliza la caja del input; no se oculta indicador ni se cancela interacción nativa. Relacionado con WebKit301648 (anchura de date/time con padding en iOS).
- En `index.css`, @supports(-webkit-touch-callout:none) aplica font-size:max(16px,1em) !important a inputs/select/textarea. Conserva zoom manual; no modifica el meta viewport ni impone maximum-scale.
- Safari iOS27 simulador: campos separados y papelera libre; picker23→22; número10→vacío→24; cierre del teclado recupera encabezado/márgenes sin zoom; Confirmar y recarga conservan22:00 y24. Capturas en reports/ios-inputs-fixed.
- Chrome133 Android16/API36: runner completo11 comprobaciones PASS, incluyendo capacidad/minutos, horarios heredados y recordatorios. Primer intento de conexión CDP demasiado temprano falló; repetición una vez Chrome listo pasa completa.
- Suite960/960 (88 archivos); tests focalizados6/6 después del assert de dimensiones; build/typecheck y lint de componentes pasan.
- Publicada versión staging0452021a-27f7-4801-a5f5-d906d5eeef0e; anterior5d8ba21e-0e2d-4b35-a7bd-363a8cf8d1a1. Variables remotas conservadas mediante config temporal, ya eliminada. Sin migraciones ni producción.
- Alcance: interacción/guardado en fixture local de componentes reales. No se editaron datos de establecimientos en staging. No equivale a probar todas las versiones iOS/Android o Samsung Internet.
