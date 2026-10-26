# NoQueue mobile — checklist de implementación y publicación

Actualizado: 20/10/2026. Documento de control; no constituye autorización de despliegue.

## Cómo mantener este documento

- `[ ]`: pendiente; `[x]`: implementado/verificado según la evidencia indicada.
- No confundir código terminado con pruebas en dispositivo o despliegue terminado.
- Al cerrar una tarea, anotar prueba, resultado y cualquier limitación en el registro final.
- Mantener los pendientes aquí; no dar por disponible push hasta demostrar su entrega real.
- Orden crítico: alta segura → push real → experiencia completa → beta → stores.

## Alcance e invariantes

- [x] Cliente móvil sin registro visible, login, password ni cuenta de negocio.
- [x] Requisito aprobado: alta móvil sin teléfono ni consentimiento WhatsApp.
- [ ] Push transaccional como canal de avisos móvil; nunca activar WhatsApp como fallback obligatorio.
- [ ] Seguir usando la aplicación si se rechazan push, cámara o ubicación.
- [x] Mantener React compartido y composiciones web/native separadas (ADR 0002).
- [x] Mantener intactos contrato, consentimiento, controles de origen y notificaciones web (regresión automatizada).
- [x] No introducir analítica nativa ni identificadores publicitarios en este bloque.

## Decisiones de producto pendientes

- [ ] Confirmar si nombre/alias seguirá obligatorio. Hasta decidir: conservar el nombre operativo actual; no es una cuenta.
- [ ] Confirmar política de turnos simultáneos. Hasta decidir: no inventar restricciones distintas de las reglas actuales del servicio.
- [ ] Confirmar recuperación tras reinstalación/cambio de dispositivo. MVP: continuidad en la misma instalación; no prometer recuperación entre dispositivos.
- [ ] Definir transferencia explícita de un turno web a la app: este bloque no vincula automáticamente capabilities de otra instalación o del canal web al abrir un enlace.
- [x] IDs actuales: Android `com.noqueueapp.android` (migrado el25/10/2026 para Play); iOS `com.noqueue-app.ios`, equipo Apple `6VYYNUZPSH`. Apple rechazó el ID original por no estar disponible. No hay migración entre ambos bundles iOS.

## Estrategia de cobertura — compartida y específica de mobile

Aprobada el20/10/2026: **reutilizar la cobertura compartida; probar el delta móvil**.
Un límite de una ejecución concreta no equivale a falta de cobertura del proyecto.

| Área | Cobertura que se hereda de web/backend | Validación específica de mobile |
| --- | --- | --- |
| Capacidad, horarios, grupos, salas, estimación | Suites del motor y contratos compartidos; mantener regresión automatizada | Alta y campos operativos por servicio, ya comprobados localmente |
| Llamado, atendido, caducidad, cesión/cancelación | Transiciones, versionado y reglas del backend | Lectura/autorización/pantallas y recuperación nativa, ya comprobadas |
| UI staff | Conservar sus pruebas web existentes, sin duplicar toda la matriz en iOS/Android | Un flujo staff→turno móvil integrado antes de release; no repetir panel completo |
| Concurrencia/idempotencia | Aprovechar pruebas del coordinador; una carencia compartida se corrige una vez en API | Aislamiento entre instalaciones, retry y respuesta perdida, ya comprobados; revisar casos nuevos de push |
| Búsqueda/QR | Reutilizar lógica de búsqueda, validación y pantallas web disponibles | Integrar rutas, cámara, permisos y enlaces nativos (bloque3) |
| Identidad/almacenamiento | No heredable del navegador | Keychain/Keystore, reinicio/actualización/corrupción, comprobados en simuladores |
| Notificaciones | WhatsApp NO valida push | Registro, tokens, APNs/FCM, permisos, background y apertura segura (bloque2) |

No se exige ejecutar de nuevo toda la matriz web manualmente en dos simuladores.
Los registros históricos conservan los límites de cada ejecución; prevalece esta
clasificación para planificar el trabajo siguiente.

## Bloque 1 — Alta móvil anónima y acceso seguro (VALIDADO EN LOCAL / CERRADO)

- [x] Cierre local aprobado por el usuario el20/10/2026. Se avanza al bloque2.
- [x] Evidencias de API/UI, simuladores y recuperación recogidas abajo; no se amplía indefinidamente este bloque.
- El cierre local **no** declara validado hardware, staging ni distribución.

### Contrato y backend

- [x] Contrato móvil estricto: nombre y datos operativos, sin teléfono/WhatsApp.
- [x] Ruta móvil explícita; el cliente no puede seleccionar el canal mediante un campo en el alta web.
- [x] Alta independiente de readiness, plantillas y activación WhatsApp.
- [x] Mismas reglas de apertura, capacidad, recepción, grupo y sala que el alta pública.
- [x] Idempotencia aislada por instalación/canal; reintentos no crean turnos duplicados.
- [x] Identidad anónima con secreto aleatorio, sin hardware IDs ni cuentas.
- [x] Persistencia de asociación instalación–turno; el ID público nunca autoriza operaciones.
- [x] Conservar capability secreta por turno; validar propiedad en API móvil.
- [x] Límites de abuso, errores no reveladores, no-store y no-referrer.
- [x] Ninguna escritura de teléfono, consentimiento o envío WhatsApp para alta móvil.
- [x] Migración aditiva y compatible con las versiones web actuales.

### App y almacenamiento

- [x] Transporte API móvil con base URL explícita, HTTPS, sin cookies y sin enviar secretos a orígenes arbitrarios.
- [x] CORS limitado a rutas móviles y orígenes nativos conocidos; no debilitar guardas web/staff.
- [x] Formulario móvil sin teléfono/consentimiento; conservar campos del negocio.
- [x] Almacenamiento seguro nativo de identidad e intenciones; capabilities recuperadas desde API autorizada, no localStorage para secretos.
- [x] Error visible y cerrado ante fallo de almacenamiento; no regenerar identidad silenciosamente si hay corrupción.
- [x] Guardar intención idempotente antes del envío y recuperar alta tras respuesta perdida.
- [x] Recuperar acceso a turnos al relanzar la misma instalación.
- [x] Lectura y comandos del turno con identidad y capability correctas.

### Gate de validación del bloque 1

- [x] Tests contrato: rechazo de WhatsApp/teléfono/canal inyectado, datos inválidos.
- [x] Tests API: producción sin WhatsApp admite móvil y sigue bloqueando web según su política.
- [x] Tests API: ausencia/secreto inválido/otra instalación/token ajeno no acceden al turno.
- [x] Tests API: CORS/preflight, rate limit, idempotencia, capacidad y comandos versionados.
- [x] Tests UI: alta móvil sin teléfono, recuperación/reintentos y errores de almacenamiento.
- [x] Regresión formularios web, kiosk, consentimiento y ciclo WhatsApp.
- [x] Typecheck, lint y build web, con resultados registrados.
- [x] Compilación iOS Debug para simulador, sin firma (no equivale a ejecución).
- [x] Ejecución iOS en simulador: alta anónima, Keychain real device-only, recuperación y cancelación en procesos distintos.
- [x] iOS: pérdida de dos respuestas después de commit real; retry en el mismo proceso y tras reinicio sin duplicados, misma clave/capability.
- [x] Restaurante y piscina en ambos simuladores: altas anónimas, recuperación, gestión permitida por servicio, cesión/replay/versionado, autorización y cancelación (registro multiservicio abajo).
- [x] Llamado, atendido (`completed`/`arrived`) y caducado (`expired`) en restaurante/piscina, ambos simuladores: recuperación tras reinicios, identidad estable, enlaces conocidos autorizados y terminales ausentes de activos (registro de ciclo abajo).
- [x] iOS: actualización sobre la instalación existente1001→1002, sin uninstall/reset; conserva Keychain, dos turnos y reintento pendiente. Replay200 sin duplicados y cancelaciones después de actualizar.
- [x] iOS: corrupción real de Keychain (JSON/esquema/UTF8), fallo cerrado sin regenerar identidad ni tráfico autenticado; restauración y relanzamiento verificados.
- [x] Verificar atributos Keychain `WhenUnlockedThisDeviceOnly`, sin sincronización iCloud y misma identidad tras relanzar.
- [x] Verificar que el turno cancelado no reaparece tras otro arranque y que el alta iOS no crea contactos/consentimientos/outbox WhatsApp.
- [x] Toolchain Android local: JDK 21, SDK 36, Gradle del repositorio e imagen ARM64 API36.
- [x] Compilación Android Debug y ejecución del APK en emulador real (no browser con runtime simulado).
- [x] API HTTPS efímera local con migración 0029, datos ficticios, sin servicios externos ni despliegue.
- [x] Smoke Android: alta, autorización, cierre/reapertura, reemplazo APK, respuesta perdida/idempotencia y cancelación.
- [x] Keystore emulado: archivo cifrado/no-backup, corrupción falla cerrada y no regenera identidad; sin secretos en logs del proceso comprobado.
- [x] Certificado de desarrollo opt-in solo Debug; comprobar ausencia en recursos/manifest Release y rechazo explícito de Release con TLS local.
### Comprobaciones posteriores de integración/release (no reabren el bloque1 local)

- [ ] Ejecución del vault Keychain/Keystore en dispositivos reales.
- [ ] Validación manual iPhone/Android: alta sin teléfono, cierre/reapertura y cancelación.
- [ ] Migración/despliegue staging autorizado por separado y smoke en entorno real.

## Bloque 2 — Push (implementación local en curso; envío real NO validado)

Bloque1 local cerrado. **OFF por defecto** tanto backend como build nativo.
Credenciales APNs creadas y custodiadas localmente con autorización posterior (registro abajo). FCM: IAM, custodia local y validación OAuth/FCM `validate_only` completados el21/10/2026, sin entrega. No se migran bases remotas ni se despliega.

### Implementación específica de mobile

- [x] Contrato estricto, registro autenticado por instalación, sin teléfono ni consentimiento WA.
- [x] FCM para iOS y Android, plataforma separada del proveedor; token cifrado AES-GCM y hash HMAC, locale y última actividad. APNs directo sustituido en la ruta activa.
- [x] Rotación por propietario; no transferir un token conocido a otra instalación automáticamente.
- [x] Revocación elimina token y descarta pendientes; respuesta de token inválido no borra uno recién rotado.
- [x] Control de permisos en contexto del turno; listeners antes de register, registrationError, timeout y reintento visible.
- [x] Al volver a primer plano, refrescar registro existente sin volver a pedir permiso; rechazo no bloquea alta/consulta.
- [x] Callbacks APNs AppDelegate y entitlement de dispositivo Debug/Release preparados; canal Android configurado por el cliente.
- [x] Auditoría de ajustes resueltos Xcode: bundle/team, Debug development, Release production y exclusión de entitlement en simulador. Capacidad Push visible en proyecto; foreground explícitamente sin banner/sonido duplicado (solo refresco del turno).
- [x] Outbox independiente de WhatsApp, atómico con cambios de estado y deduplicado por turno/versión/tipo.
- [x] Primeros avisos: llamada, caducidad y cancelación; confirmación de alta sigue en la app.
- [x] Dispatcher serializado por cola, recuperación periódica acotada, lease, backoff, límite de intentos y TTL.
- [x] Descartar aviso obsoleto por versión/estado, tenant suspendido, registro revocado o TTL vencido.
- [x] Adaptadores APNs y FCM HTTPv1; credenciales separadas por entorno, sin redirecciones ni logs sensibles.
- [x] Gate iOS independiente `FCM_IOS_ENABLED=false`, bundle validado y gate nativo `NoQueueFcm.enabled=false`; configurar Android no habilita iOS. `APNS_TRANSPORT_VERIFIED` queda legacy, sin uso por la ruta activa.
- [x] Diagnóstico local APNs reproducible: firma P-256 offline y conexión Node TLS1.3/HTTP2 a Sandbox/Production, sin HTTP requests, JWT, device tokens ni notificaciones. **No valida autorización APNs ni transporte Workers.**
- [x] Payload genérico sin nombres, teléfono, identidad ni capabilities; solo identificador de notificación no autorizante.
- [x] Al tocar aviso: resolver propiedad por API y abrir turno consultando estado actual, también si terminó; nunca confiar en URL del payload.
- [x] Persistir intentos/último error y aceptación del proveedor; no confundir aceptación con entrega/lectura.
- [x] Mantenimiento acotado: tokens inactivos90d y referencias de avisos30d; la consulta del turno no depende de conservar el aviso.

### Pendientes para completar push y habilitarlo

- [ ] Avisos de proximidad y cambios de estimación: definir política y conectar proyecciones sin filtros WA.
- [x] IDs y capacidad Push registrados; APNs Sandbox/Production con claves separadas limitadas al topic. Firebase Android y `google-services.json` configurados localmente.
- [x] Certificado/perfil de desarrollo iOS con Push y entorno firmado validado en iPhone físico el 21/10. APNs development y dispositivo incluidos; entrega local posterior validada abajo.
- [x] FCM IAM: permisos temporales verificados; rol `noqueueFcmSender` creado y asignado a la cuenta dedicada, solo `cloudmessaging.messages.create`.
- [x] Crear una única clave FCM con autorización explícita (ID `101b0cca37d37fd840dd7207bbb35f612bc5a74b`).
- [x] JSON FCM localizado y movido de Downloads a `/Users/usuario/.config/noqueue/push/` (0600/0700); metadata actualizada. Firma RSA, OAuth y FCM `validate_only` passed el21/10/2026, sin entrega ni clave adicional.
- [ ] Al terminar la configuración, Alberto retira los dos roles temporales de Johan, conservando Editor y el rol mínimo de la cuenta FCM.
- [x] Credencial usada en entorno local autorizado y entrega real APNs development
  al iPhone firmada correctamente; clave permanece fuera Git.
- [ ] Credenciales/entitlements de staging y distribución APNs production: validar
  en intervención independiente, no extrapolar el smoke Development.
- [x] Runtime workerd local → FCM HTTPv1 → APNs development → iPhone: aviso real
  recibido en bloqueo y apertura propietaria de H6RZ76 (21/10, evidencia al final).
- [ ] Repetir desde runtime desplegado autorizado; no afirmar Cloudflare remoto
  validado a partir del runtime local, ni producción APNs desde Development.
- [x] Sustituir necesidad de APNs directo por Worker → FCM HTTPv1 → APNs → iOS. No se marca HTTP/2 Workers como verificado ni se añade relay.
- [x] Puente FirebaseMessaging iOS, token FCM explícito, lifecycle/rotación/revocación y migración0032 probados localmente. Sin Firebase Auth/Analytics ni cambios en identidad o UI.
- [x] App Firebase iOS registrada; configuración cliente instalada/validada localmente y claves APNs existentes subidas con confirmación explícita (Sandbox33FG9322FT / ProductionW666TVNM38). Push sigue OFF.
- [ ] Revisar privacidad/declaraciones stores por Firebase Installations antes de
  distribuir/activar para usuarios; SDK usado solo en smoke físico autorizado.
- [ ] Si se soporta Android <=12, añadir detección nativa de notificaciones bloqueadas en ajustes; `checkPermissions()` del plugin no lo detecta.
- [x] iPhone físico: alta → segundo plano/pantalla bloqueada → aviso real → apertura
  del turno correcto, sin perder identidad anónima (H6RZ76).
- [ ] Físico: arranque desde proceso terminado, permisos revocados, token rotado,
  red móvil fuera de LAN y Android; no cubiertos por esta prueba.
- [ ] Completar política de notificaciones ya entregadas/obsoletas y observabilidad operativa antes de release.
- [ ] Activación y smoke staging autorizados por separado. **No autorizados en esta sesión.**

Implementación y pruebas reproducibles: `docs/runbooks/mobile-push.md`.

## Bloque 3 — Experiencia pública móvil (alineación web y turno único)

**La composición anterior con «Inicio / Mis turnos» está sustituida.** Sus capturas
se conservan como evidencia histórica, no como aceptación de la UI actual.

- [x] Mismos componentes de inicio, búsqueda, filas, filtros, establecimiento y cronómetro que web; sin navbar, enlaces extra ni catálogo global añadido.
- [x] `/turns` solo redirige por compatibilidad. Arranque/foreground/otro servicio abren el único turno activo; no dependen de push.
- [x] Alta móvil conserva nombre/campos operativos, sin teléfono ni WhatsApp; flujo web preservado.
- [x] Garantía atómica por instalación entre colas/establecimientos: migración0031, preflight duplicados, conflicto409 autenticado y protección de reactivaciones.
- [x] Idempotencia antes de exclusividad; conservación de identidad/reintentos; errores de recuperación y tenant suspendido fallan cerrados.
- [x] Pantallas terminales compartidas permanecen visibles; nueva cola solo cuando no existe turno waiting/called.
- [x] API mobile/search conserva catálogo/schema/reglas web y límites específicos.
- [x] Push contextual reducido a acción secundaria bajo el turno; OFF no muestra controles ni pide permisos.
- [x] Ubicación nativa opt-in y sin background; aproximada en Android12+, con compatibilidad de permiso anterior acotada a SDK30. Búsqueda manual alternativa.
- [x] QR con diálogo y lector compartidos, permisos cámara opcionales y cierre de captura; sin micrófono/galería.
- [x] QR nativo valida origen HTTPS público configurado y destinos q/v; rechaza dominios ajenos y parámetros no autorizados.
- [x] Recorrido en WebViews reales iOS/Android: inicio → búsqueda/filtros → formulario/ficha → alta → recuperación automática → intento de otro servicio → cancelación → catálogo desbloqueado. Identidad estable, cero push/WhatsApp.
- [x] Ubicación simulada con plugin real en ambos sistemas; cámara virtual Android abre/cierra y libera tracks. No equivale a lectura óptica física.
- [x] Capturas nuevas de seis estados en simuladores y referencias web equivalentes; revisión visual local. Efecto nativo iOS26+ de desenfoque desactivado.
- [ ] Lectura de QR impreso y permisos revocados en dispositivos físicos iPhone/Android.
- [ ] Matriz de ubicación en Android24–30: permiso combinado del plugin declarado con maxSdkVersion30; ejecución validada por ahora en API36.
- [ ] Universal Links/Android App Links y asociaciones de dominio; mismo QR externo abre app instalada o web.
- [ ] QA manual completa de teclado, gestos, VoiceOver/TalkBack, texto ampliado y orientación.
- [ ] Revalidación de actualización binaria y de las suites históricas multiturno con escenarios secuenciales de turno único (la cobertura anterior se conserva, no se atribuye a este flujo).
- [ ] Tratamiento de instalación reiniciada/credenciales perdidas; no prometer identidad entre dispositivos.

Pruebas locales no sustituyen release/hardware. **No se ha desplegado ni enviado
notificaciones reales.** El bloque3 completo sigue abierto por los puntos anteriores.

## Bloque 4 — QA y regresión

Este bloque es el gate de beta/release, no una reapertura del bloque1 local.
Reutilizar su evidencia de identidad, red e idempotencia; repetir únicamente el
delta push, cambios posteriores o plataformas/dispositivos aún no cubiertos.
Las reglas compartidas se verifican con suites backend/web, no triplicando toda
la matriz manual en web, iOS y Android.

- [ ] Matriz de dispositivos/versiones iOS/Android reales; browser emulado no sustituye nativo.
- [x] Actualización de bundles locales en simulador iOS conservando identidad, turnos e intención idempotente pendiente.
- [ ] Primera instalación/actualización de versiones distribuidas y matriz de dispositivos reales.
- [ ] Cámara/ubicación/push concedidos, denegados y revocados en ajustes.
- [ ] App foreground/background/cerrada, push retrasada y apertura de turno terminado.
- [ ] Sin red, timeout después de commit, doble pulsación y reintento idempotente.
- [ ] Cancelación/modificación/cesión concurrentes y conflictos de versión.
- [ ] Tokens rotados/inválidos y reinstalación, sin filtraciones entre instalaciones.
- [ ] Regresión web completa (discovery, QR, consentimiento, WhatsApp, gestión turno).
- [ ] Pruebas de autorización, límites de abuso y ausencia de secretos en logs/analítica.
- [ ] Evidencia reproducible de los casos críticos antes de beta externa.

## Bloque 5 — Infraestructura de release y privacidad

- [ ] Revisar accesos a cuentas empresa Apple/Google existentes y roles para envío a revisión.
- [ ] IDs definitivos, certificados/perfiles, firma Android, custodia de claves y versionado.
- [ ] Builds release reproducibles y CI iOS además de Android; no confundir assembleDebug con release.
- [ ] Entornos API/push de staging y producción separados; migraciones antes de app cliente.
- [ ] Compatibilidad de API con versiones móviles antiguas y despliegue/rollback aditivos.
- [ ] Revisar permisos, manifests de privacidad, SDK y datos realmente transmitidos.
- [ ] Política de privacidad accesible en app; retención/borrado de datos de instalación.
- [ ] App Privacy y Data Safety coherentes con identificadores, tokens, nombre y ubicación usados.
- [ ] Mantener analítica nativa desactivada salvo decisión y revisión específicas.
- [ ] Verificar requisitos vigentes justo antes de subir (20/10/2026: Apple Xcode/SDK26+, Google target36; Android ya declara36).

## Bloque 6 — Beta y publicación

- [ ] TestFlight y pista de pruebas Google Play, distribución limitada y feedback.
- [ ] Iconos, splash, capturas reales, descripción, categorías, edades y soporte.
- [ ] Establecimiento de demostración disponible para revisión sin login cliente ni datos reales.
- [ ] Instrucciones para revisar QR, alta, seguimiento y push.
- [ ] Comprobar utilidad nativa y funcionamiento sin push; no enviar un shell incompleto.
- [ ] Corregir incidencias de beta y repetir gates críticos.
- [ ] Autorización explícita para despliegue final/envío a stores.
- [ ] Lanzamiento gradual con monitoreo de altas, errores, push y soporte.

## Fuentes y contexto

- `docs/decisions/0002-single-react-two-experiences.md` — composición compartida.
- `docs/architecture/runtime-channels.md` — canales web/native.
- `docs/runbooks/mobile-local.md` — preparación y compilación nativa.
- [Apple Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Apple SDK requirements](https://developer.apple.com/news/upcoming-requirements/?id=02032026a)
- [Google target API](https://support.google.com/googleplay/android-developer/answer/11926878)
- [Google Data Safety](https://support.google.com/googleplay/android-developer/answer/10787469)
- [Capacitor push](https://capacitorjs.com/docs/apis/push-notifications)

## Registro de avances

### 20/10/2026 — inicio

- Plan convertido en checklist por solicitud del usuario.
- Autorizado implementar bloque 1, no desplegar ni activar push.
- Decisiones conservadoras: conservar nombre operativo; sin recuperación prometida entre dispositivos; web no cambia.
- Validaciones y pendientes del bloque 1: se actualizarán tras ejecutar las pruebas.

### 20/10/2026 — implementación del bloque 1

**No desplegado.** Push, discovery completo, enlaces OS y stores continúan pendientes.

Cambios:
- Migración aditiva `0029_mobile_installations.sql`: asociación atómica entrada–hash de instalación; borrado en cascada con el turno. No modifica contactos/consentimientos web.
- `mobileServiceJoinSchema`: alta estricta sin teléfono/WhatsApp, conserva nombre, idioma y datos de servicio.
- `/api/v1/mobile/*`: origen nativo acotado, secreto de instalación en Authorization, cuotas por IP/instalación, no cookies, no-store/no-referrer.
- Identidad generada con 32 bytes aleatorios; backend guarda SHA-256 separado por dominio, nunca el secreto. No hay registro/login humano, hardware ID ni identificación de una persona.
- Alta usa `mobile-app` exclusivamente desde la ruta del servidor y claves idempotentes aisladas por instalación. Funciona con WhatsApp apagado; no crea contacto, consentimiento ni avisos WhatsApp del turno móvil.
- Cada turno mantiene su recovery capability. Lectura/comandos móviles exigen además pertenencia a la instalación. La capability web existente sigue siendo un enlace portador privado, no un ID público.
- `NoQueueVault`: Keychain device-only en iOS; Android Keystore AES-GCM con archivo atómico excluido de backups. Sin fallback localStorage. El secreto se guarda antes de hacer peticiones.
- Intenciones de alta persistidas antes de POST, máximo 50 pendientes; reintentos ambiguos conservan clave. Errores definitivos de admisión/validación limpian la intención, sin abandonar commits inciertos.
- Inicio móvil mínimo de recuperación de turnos activos (hasta 50), acceso desde cabecera y formularios sin campos WhatsApp. No es todavía el inicio discovery final.
- Recuperación servidor desde el secreto incluso si se pierde la respuesta de alta; no se promete recuperación tras borrar datos/reinstalar/cambiar dispositivo. iOS puede conservar Keychain tras reinstalar: no depender de ello ni usarlo como garantía.

#### Contrato HTTP móvil

Todas las peticiones efectivas requieren `Authorization: Bearer <secreto-256-bit-hex>`.
`Origin` permitido: `capacitor://localhost` o `https://localhost`; no es atestación de app legítima ni autenticación por sí solo.

| Método y ruta bajo `/api/v1/mobile` | Uso |
| --- | --- |
| `GET /services/:id` | Servicio público y admisión |
| `GET /venues/:id/services` | Servicios visibles del establecimiento |
| `POST /services/:id/entries` | Alta estricta + `Idempotency-Key` UUID |
| `GET /entries` | Recuperación de turnos activos de esta instalación |
| `GET /entries/:token` | Estado, comprobando instalación y capability |
| `POST /entries/:token/commands` | Cancelar/modificar/ceder según versión/estado, con UUID idempotente |

La identidad es anónima pública: cualquiera puede generar su propia instalación, no acceder a otra. No se ha añadido App Attest/Play Integrity. Las cuotas IP impiden eludir el límite simplemente regenerando el secreto.

#### Secuencia para validación staging (requiere autorización de despliegue)

1. Revisar migración 0029 y backup/rollback del entorno elegido.
2. Aplicar migración antes de publicar la API; el web antiguo continúa compatible.
3. Publicar API con rutas móviles y verificar ausencia de efectos en WhatsApp web.
4. Compilar React con `VITE_API_URL` apuntando al **origen HTTPS** correcto (sin `/api`, query ni credenciales).
5. Sincronizar Capacitor y compilar iOS/Android. El artefacto local de validación usa `https://mobile-api.invalid`: es solo para compilación y no debe distribuirse.
6. Instalar en dispositivos físicos y probar alta, recuperación, cancelación y fallos de almacenamiento/red.
7. No publicar en stores ni prometer push hasta completar los bloques restantes.

#### Evidencia automatizada

- Suite web completa: 65 archivos / 601 tests correctos.
- Suite API completa: 58 archivos / 704 tests correctos (17 específicos de API móvil).
- Contratos: 14 archivos / 87 tests correctos.
- Preparación de producción/migraciones/backup: 45 tests correctos, sin operaciones remotas.
- Typecheck raíz: 6 tareas correctas.
- Lint web: 0 errores; 2 warnings previos en Stepper y CreateEstablishmentDrawer, fuera del cambio.
- Build React/Vite correcto; sincronización Capacitor iOS/Android correcta.
- Xcode 27.1: build Debug iOS simulator **SUCCEEDED**, sin firma. CoreSimulator informa versión del servicio desactualizada; no se ejecutó simulador ni dispositivo.
- Android: no JDK detectado; compilación pendiente (no se instaló un toolchain sin acordarlo).
- No ejecutados: smoke contra staging real, E2E browser completos de este turno, pruebas físicas, push, firma release o envío a stores.

#### Próximo paso inmediato

- [x] Resolver toolchain Android y ejecutar smoke nativo local del bloque 1 (ver registro siguiente; no cierra hardware/staging; iOS validado en registro posterior).
- [ ] Autorizar y validar staging con migración 0029 antes de usar la app contra un servidor.
- [ ] Probar Keychain/Keystore en dispositivos reales, incluida reapertura tras cierre y actualización.
- [ ] Después: bloque 2 push; no mezclar su activación con la preparación de stores.

### 20/10/2026 — continuación: Android compilado y probado localmente

**Sin despliegue.** No se han aplicado migraciones remotas, activado push,
modificado WhatsApp productivo, firmado release ni distribuido la app.

#### Preparación reproducible

- JDK Homebrew 21.0.12.1, Gradle wrapper 8.14.3 / AGP 8.13.0.
- SDK compile/target36, build-tools35.0.0, emulator37.2.12 e imagen API36
  Google APIs ARM64 revisión7 (perfil Pixel7; WebView133.0.6943.137).
- Variables por sesión en `apps/mobile/scripts/android-env.sh`; no cambios a `.zshrc`.
- HTTPS `https://127.0.0.1:8788` por `adb reverse`; certificado local generado,
  ignorado por Git y confiado únicamente en Debug opt-in para loopback.
- Harness `apps/api/scripts/dev-mobile.mjs`: configuración exclusivamente de test,
  migraciones locales automáticas, DB efímera, un servicio de recepción 24h,
  WhatsApp OFF y red externa del Worker bloqueada. No lee `.dev.vars` reales.
- `loggingBehavior: 'none'`: evita que el bridge nativo registre argumentos del
  vault que contienen identidad/intenciones. No se ha añadido analítica.
- Comandos, recuperación y cierre documentados en `docs/runbooks/mobile-local.md`.

#### Evidencia en emulador — 10 comprobaciones correctas

1. Inicio genera identidad nativa anónima sin cuenta/login/registro.
2. Alta desde formulario real sin teléfono/WhatsApp: POST devuelve201.
3. Otra instalación obtiene404 al leer/cancelar; sin credenciales devuelve401.
4. Archivo de vault cifrado en `no_backup`; identidad y turno sobreviven force-stop.
5. Reemplazar **el mismo** APK con `adb install -r` conserva identidad y turno.
   No sustituye una migración entre versiones de app diferentes.
6. Cancelar desde UI devuelve200 y retira el turno de la lista activa.
7. Se pierde la respuesta **después del commit real**; la app se cierra/reabre,
   recupera el turno y reintenta con la misma clave persistida:200, sin duplicado.
8. D1 final:2 turnos cancelados,2 asociaciones,0 contactos,0 consentimientos,
   0 mensajes en outbox WhatsApp.
9. Logs del proceso inspeccionado sin secreto de instalación ni capability.
10. Corromper el vault del emulador produce error visible y rechazo de lectura,
    sin regenerar identidad. Restaurar el archivo original recupera acceso.

Runner: `tests/e2e/mobile/android-smoke.mjs` (`pnpm --filter @noqueue/e2e test:android`).
Controla el WebView real mediante CDP, sin mock del runtime ni de las respuestas API.
La entrada `/q/:id` se abre mediante inspector: **no prueba QR ni App Links**.
Capturas revisadas e informe sin credenciales en `reports/android-local/`
(ignorado; `smoke-result.json`, `01-mobile-form.png`, `02-active-turn.png`,
`03-recovered-turn.png`).

#### Gates repetidos

- Android `assembleDebug`: **BUILD SUCCESSFUL**, 185 tareas iniciales.
- Android `lintDebug`: **BUILD SUCCESSFUL**, 0 errores /13 avisos sobre plantilla,
  recursos/iconos y actualización de Gradle; no se han ocultado ni actualizado
  dependencias fuera de alcance para silenciarlos.
- Recursos/manifest Release sin configuración/certificado local.
- Intentar `assembleRelease` con `noqueueLocalTlsDir`: rechazo esperado,
  `Local TLS is forbidden in Release builds` (no es un fallo pendiente).
- API:58 archivos /704 tests correctos.
- Web:65 archivos /601 tests correctos; conserva regresión web/WhatsApp.
- Herramientas mobile:4 tests correctos (incluyen límites Debug/Release y logs).
- Typecheck raíz:6 tareas correctas. `git diff --check` correcto.

#### Pendientes reales del bloque 1

- [x] Ejecución iOS y prueba Keychain en simulador; ver registro posterior de tres fases reales.
- [ ] Android/iPhone físicos, distintas versiones y actualización entre versiones reales.
- [ ] Pruebas nativas de restaurante/piscina y navegación con teclado/back/safe areas;
  este smoke nativo cubre recepción, no toda la matriz de UX.
- [ ] Revisar los 13 avisos Android Lint antes de release (recursos/iconos, orden
  del manifest y actualización compatible del wrapper).
- [ ] Smoke staging con autorización separada; **no autorizado ni realizado en esta sesión**.
- [ ] Revisar decisión de recuperación tras reinstalación/cambio de dispositivo;
  no prometerla por haber validado `install -r`.

Los assets y el APK actuales apuntan a **loopback local** y no deben distribuirse.
Recompilar con la API HTTPS del entorno autorizado y sincronizar antes de generar
cualquier artefacto destinado a otras personas. Push sigue pendiente del bloque2.

Al terminar se detuvieron la API efímera y el emulador; se conservan SDK, AVD,
APK y evidencias para repetir el circuito con el runbook. No se deja un servidor
local de pruebas abierto en segundo plano.

### 20/10/2026 — continuación: iOS ejecutado en simulador

**Sin despliegue, sin migraciones remotas y sin activar push.** No se ha cambiado
el flujo web ni el código de admisión/vault para facilitar estas pruebas.

#### Entorno y aislamiento

- Resuelto el bloqueo local de CoreSimulator: preparación oficial de Xcode y
  actualización del servicio1171.7→1174.9.2. No se borraron simuladores existentes.
- Xcode27.1 (27A9275), SDK27.1; ejecución en **iPhone17, iOS27.0 (24A434), ARM64**.
- Simulador dedicado `NoQueue iOS local`, sin cuentas personales.
- Se reutiliza la API HTTPS efímera del smoke Android: loopback127.0.0.1:8788,
  datos ficticios, migraciones locales, WhatsApp OFF y tráfico externo bloqueado.
- Certificado local confiado **solo en ese simulador**, no en el llavero del Mac.
  Sin excepciones ATS ni bypass de validación TLS en la app.
- Nuevo target `AppLocalTests` y scheme `LocalSmoke`, separados del producto App.
  Ejecutan XCTest alojado en la app y operan su WKWebView real mediante DOM;
  no simulan Capacitor, Keychain ni respuestas de API.

#### Resultado: tres fases XCTest, tres procesos de app

- [x] **Alta y Keychain:** formulario sin teléfono/WhatsApp, POST autenticado201;
  el plugin lee el mismo registro que `SecItemCopyMatching`. Identidad256bit,
  `WhenUnlockedThisDeviceOnly`, sin sincronización iCloud y sin intención pendiente
  después del éxito. Capturas de formulario y turno activo.
- [x] **Recuperación y cancelación:** nuevo PID de app, mismo hash de identidad y
  mismo hash de ruta del turno; lista recuperada desde servidor. Otra instalación
  obtiene404 al leer/cancelar; sin credenciales401. Cancelación desde UI devuelve200
  y deja la lista de turnos activos vacía.
- [x] **Otro arranque después de cancelar:** misma identidad en Keychain y ningún
  enlace a turno activo. La cancelación no depende de estado React en memoria.
- [x] **D1 final:**1 turno cancelado,1 asociación instalación–turno,0 contactos,
  0 consentimientos y0 registros en outbox WhatsApp.

Checkpoint de pruebas: solo hashes, PID e ID público de servicio; no secreto ni
capability. Resumen final en `reports/ios-local/smoke-result.json` con estado
`passed`; cada fase tiene `.xcresult` y capturas adjuntas en su carpeta de ejecución.
Se revisaron visualmente las capturas exportadas. El nombre del fixture sigue
siendo «Recepción Android local» porque se reutiliza el servicio del harness;
la ejecución comprobada es iOS, no Android.

#### Gates adicionales

- `build-for-testing` Debug: **TEST BUILD SUCCEEDED**; firma ad-hoc del simulador,
  sin certificado de distribución ni cuenta Apple para publicar.
- Tres ejecuciones `test-without-building`: **3 tests /0 fallos /0 omitidos**.
  El runner rechaza una selección vacía aunque Xcode devuelva éxito.
- Build ordinario del target App, configuración Release **para simulador y sin
  firma**: **BUILD SUCCEEDED**;0 bundles `.xctest`,0 símbolos `LocalSmokeTests`,
  sin excepciones ATS. No equivale a un archivo release para stores.
- Tests de tooling mobile:6 correctos; typecheck mobile y `git diff --check` correctos.
- Xcode imprime un aviso de parsing del número de SDK (`invalidDigitCount(94232)`),
  pero los tres resultados XCTest son Passed y sus resúmenes no registran runtime warnings.
- No se repitieron las suites completas web/API en este turno: no se modificó su
  implementación. La última regresión completa sigue siendo704 API/601 web del
  registro Android anterior.

#### Qué sigue pendiente

- [ ] Hardware iPhone/Android real; bloqueo/desbloqueo y comportamiento de Keychain
  con protección de datos real. Leer el atributo device-only no prueba un Secure Enclave físico.
- [ ] QA táctil, teclado, VoiceOver, safe areas, gestos y otras versiones iOS.
  Este smoke automatizado opera DOM en WKWebView, no toques XCUITest.
- [x] Pérdida de respuesta después de commit y corrupción en iOS: validadas en la
  ampliación de siete fases registrada abajo, sin extrapolar evidencia Android.
- [x] Actualización local iOS1001→1002 conservando identidad, turnos e intención pendiente (registro abajo); hardware/TestFlight y migraciones futuras siguen pendientes.
- [x] Restaurante/piscina: alta y gestión cliente en espera validadas en ambos simuladores (registro abajo).
- [ ] Push, QR/App Links/discovery y staging autorizado.
- [ ] Recuperación entre dispositivos/reinstalación: sigue sin prometerse.

Los artefactos iOS actuales también apuntan a loopback local: **no distribuir**.
Instrucciones reproducibles en `docs/runbooks/mobile-local.md`, sección iOS.

Cierre de esta validación: simulador `NoQueue iOS local` confirmado en estado
Shutdown y API efímera detenida. Se conservan el simulador, certificado local,
artefactos y evidencias privadas para repetir las pruebas. No hubo despliegue.


### Ampliación iOS — pérdida de respuesta, reintentos y corrupción (20/10/2026)

Sin cambios en el código de producto web/API/vault en esta ampliación. Se amplían
el bundle XCTest separado, su runner y guardas de tooling; sigue sin desplegarse.

- [x] Smoke completo **7 tests,7 procesos,0 fallos**. Se repiten las tres fases
  anteriores además de los cuatro nuevos escenarios; no solo pruebas aisladas.
- [x] Primera alta de fallo: Worker confirma201; se consume una copia de la respuesta
  real y se lanza un error antes de que llegue al código de UI. D1 tiene el turno
  confirmado y Keychain conserva una intención pendiente.
- [x] Reintento desde el formulario: servidor200, misma clave y capability; también
  se pierde esa respuesta. Solo existe un turno nuevo, no dos.
- [x] Nuevo PID: misma identidad e intención en Keychain, turno recuperado en inicio.
  Reenviar el mismo formulario devuelve200 con la misma clave/capability; limpia la
  intención solo al recibir el éxito. Cancelación por UI confirmada.
- [x] `SecItemUpdate` sobre el registro propio del simulador: JSON truncado,
  esquema inválido y UTF8 inválido. Recarga real del documento para descartar caché
  JS. Los tres muestran error/reintento,0 peticiones autenticadas y mantienen los
  bytes corruptos sin reemplazarlos por una identidad nueva.
- [x] Restauración exacta del original entre casos; UI funcional de nuevo. Otro
  arranque confirma identidad original,0 intenciones y ningún turno activo.
- [x] D1 final de esta ejecución ampliada: **2 turnos cancelados,2 asociaciones,
  0 contactos,0 consentimientos y0 registros outbox WhatsApp**. Sustituye el conteo
  de1 turno del smoke anterior, no su evidencia histórica.
- [x] Tooling mobile **7/7**, typecheck mobile y `git diff --check` correctos.
- [x] Regresión focalizada web **29/29**: instalación, transporte cliente,
  MobileAdmission y PublicQueue. No se repiten suites completas API/web ni build
  Release; la implementación de producto no cambia en esta ampliación.

Evidencia privada local (ejecución histórica): `reports/ios-local/run-GHJTLj`, con
`.xcresult` por fase y capturas de error exportadas; resumen
`reports/ios-local/smoke-result.json` = `passed`. Capturas de respuesta perdida y
error Keychain revisadas visualmente. En esa ejecución previa el bundle XCTest
tenía target15 y algunas librerías de pruebas17; esa observación no describe la
configuración vigente, que ahora exige iOS18. La suite actual aún requiere una
build/validación nativa en runtime iOS18 para acreditar el mínimo.

**Límites:** pérdida inyectada en fetch/UI después del commit, no corte de radio
físico. Corrupción del registro de la app, no del llavero global ni de Secure
Enclave. El original se conserva solo en RAM y se restaura con `defer`, incluido
fallo de aserción/throw; un crash/SIGKILL durante esa fase no garantiza restauración
(ver runbook). No se ha implementado recuperación automática de credenciales
corruptas en producción. Pendientes en ese momento: hardware real, actualización
iOS (validación local completada en el registro siguiente), QA táctil,
otras versiones y push. Cierre confirmado: API efímera detenida y simulador
`NoQueue iOS local` en estado Shutdown. No hubo despliegue.


### Actualización iOS sobre instalación existente (20/10/2026)

- [x] Nuevo comando reproducible `pnpm --filter @noqueue/mobile test:ios:upgrade`.
  **3 fases XCTest,3 procesos,0 fallos** en iPhone17/iOS27.0, Xcode27.1.
- [x] Dos builds Debug ad-hoc **1.0.0 (1001) → 1.0.1 (1002)**, mismo
  `com.noqueue.app`; números aplicados por CLI, sin cambiar versiones del proyecto.
  Se verifican versión/build del bundle instalado y del proceso con `Bundle.main`.
- [x] Antes de actualizar:2 turnos activos, uno confirmado al cliente y otro
  confirmado en servidor con respuestas perdidas201/200;1 intención persistida.
- [x] Instalar1002 sobre1001 mediante `simctl install`, sin desinstalar, borrar
  Keychain, recrear fixture ni reiniciar la API entre builds. Checkpoint Documents
  conservado byte a byte y DB sin cambios durante la instalación.
- [x] Después: mismos bytes completos de Keychain (identidad, intención, clave y
  payload), atributos device-only/no-sync y nuevo PID. Recupera ambos turnos
  originales y abre el confirmado, verificando acceso además del listado.
- [x] Reenvío de la intención pendiente:200, misma clave/capability,2 turnos totales
  sin tercero duplicado; intención borrada solo tras éxito recibido. Ambas
  cancelaciones por UI funcionan en1002.
- [x] Otro arranque de1002 conserva identidad original,0 pendientes y0 turnos activos.
- [x] D1 final:2 cancelados,2 asociaciones,0 contactos/consentimientos/outbox WhatsApp.
- [x] Tooling mobile8/8; regresión focalizada web29/29; typecheck mobile y
  `git diff --check` correctos. No se repiten aquí las suites completas API/web,
  el smoke independiente de corrupción ni el build Release.

**Evidencia:** `reports/ios-local/upgrade-result.json` = `passed`,
`reports/ios-local/run-4bZXT7` con resultados por fase y captura de ambos turnos
recuperados. Los artefactos privados no se publican ni se distribuyen.

**Hallazgo del runner:** el primer intento (`run-UsjDf3`) falló por exigir la misma
rutaUUID del contenedor. El simulador la cambia durante la actualización aunque
conserve sus datos. Se corrigió la guarda para comprobar contenido, no pathname;
se completó el diagnóstico sobre los mismos datos y se repitió el recorrido entero
con una nueva API efímera. La ejecución final registra `dataContainerPathChanged:
true`, `checkpointPreserved:true` y `databaseUnchanged:true`. No se corrigió código
de producto ni se borró/recreó identidad para conseguir el resultado.

**Alcance:** ambos builds usan el código/esquema actual y solo difieren en versión
local. Esto valida conservación al sustituir el bundle, no una migración futura
entre esquemas ni cambios de Team ID/access group. Siguen pendientes actualización
TestFlight/App Store en hardware, otras versiones iOS y reinstalación/transferencia.
No se ha desplegado ni enviado nada a stores.

Cierre confirmado: captura de ambos turnos recuperados revisada visualmente,
simulador `NoQueue iOS local` en Shutdown y API efímera detenida. Se conservan
los resultados privados y la app de prueba1002; sus assets apuntan a loopback y
no son distribuibles.


### Restaurantes y piscinas — iOS y Android (20/10/2026)

**Resultado:4/4 fases iOS y4/4 fases Android**, con procesos nuevos entre fases y
API efímera nueva para cada plataforma. iPhone17/iOS27.0 y AVD `noqueue-api36`
ARM64. Se reutiliza el APK Debug local existente; iOS recompila el bundle XCTest.
No se modifica código de producto web/API/vault: solo fixtures, pruebas y tooling.

- [x] Fixtures aditivos: recepción previa conservada, restaurante con Terraza/Salón
  y piscina. Todos24h; restaurante activado explícitamente en su ventana.
- [x] **Alta:**2 grupos restaurante de2 comensales y2 turnos individuales piscina,
  desde formularios reales.201, sin teléfono/WhatsApp ni registro/login; grupo y
  preferencia de sala quedan persistidos. Piscina no presenta controles de grupo
  o sala y API rechaza alta de2 personas con400.
- [x] **Recuperación:** después de matar/reabrir la app, misma identidad y exactamente
  los tokens originales (comparados por hash), visibles en la lista. Keychain real
  con atributos device-only/no-sync en iOS; vault cifrado/no-backup en Android.
- [x] **Restaurante:** cambiar por UI2→3 comensales y Terraza→Salón; verificar datos
  y versiones en API. Mover también el segundo grupo al Salón para hacer compatible
  la cesión. Ceder mediante UI cambia orden y aumenta versión de ambos turnos.
- [x] **Piscina:** no ofrece edición; intento directo `update` rechazado409 con
  `unsupported_service`. Sí permite cesión a otro turno individual y cancelación.
- [x] **Idempotencia y concurrencia versionada:** reenviar exactamente la cesión
  confirmada y su clave devuelve200 sin nueva mutación; versión antigua409.
  Se prueban conflictos por versión, no solicitudes físicamente simultáneas.
- [x] **Sin sucesor compatible:** error visible de cesión,409 y versión intacta.
- [x] **Autorización:** otra instalación no puede leer ni cancelar ninguno de los
  dos tipos de turno (404), aunque conozca su capability.
- [x] **Cancelación:** ambos turnos de cada servicio cancelados por UI200; otro
  arranque conserva identidad pero muestra lista vacía y0 intenciones pendientes.
- [x] **D1 por plataforma:**4 cancelados (2 restaurante+2 piscina),4 asociaciones,
  0 contactos,0 consentimientos y0 outbox WhatsApp.
- [x] **Regresión local:**32 pruebas API móvil/comandos,41 pruebas web focalizadas,
  11 tooling; typecheck mobile/E2E, sintaxis de scripts y `git diff --check` correctos.
  No se repiten suites completas, smoke de actualización/corrupción ni build Release.

**Evidencia y reproducción:**

- iOS: `pnpm --filter @noqueue/mobile test:ios:services`, informe
  `reports/ios-local/services-result.json` = `passed`, `.xcresult` y capturas en
  `reports/ios-local/run-okRU4A`.
- Android: `pnpm --filter @noqueue/e2e test:android:services`, informe
  `reports/android-local/services-result.json` = `passed` y capturas `services-*.png`.
- Escenario compartido `service-scenarios.js`: recurso exclusivo del bundle XCTest,
  ejecutado también por CDP en Android; no incluido en recursos del target App.
  Checkpoints/informes solo contienen hashes, PID y resultados, nunca credenciales.
- Capturas de las cuatro altas recuperables revisadas visualmente en ambas plataformas.
  Los cambios de UI se operan por DOM; no equivalen a QA táctil/VoiceOver.

**Correcciones del entorno de pruebas, no del producto:** el primer fixture de
restaurante estaba inactivo aunque `queue.open=1`; se añadió activación explícita.
Una cesión esperaba incorrectamente que «opción rápida» fuese compatible con sala
inferida: se ajustó el segundo grupo a la misma sala mediante UI. Android devuelve
CRLF al consultar nombre de AVD; el runner normaliza la línea antes de comprobarlo.
Tras esos ajustes se repitieron completos los escenarios, sin borrar identidades.

**Pendientes de aquella ejecución:** hardware real, versiones OS adicionales, UI staff,
carreras simultáneas, push, QR/discovery y staging autorizado. Los estados
llamado/atendido/caducado se validan en el registro siguiente.
No se despliega, activa push ni publica en stores. Los artefactos siguen apuntando
a loopback local y no son distribuibles.

Cierre de esta validación: API efímera detenida, iOS `NoQueue iOS local` Shutdown,
Android `noqueue-api36` cerrado y túnel `adb reverse` retirado. Se conservan
simuladores, identidades de prueba y evidencias privadas para próximas sesiones.


## Registro — ciclo y recuperación en ambos simuladores (20/10/2026)

- [x] **iOS4/4:** `test:ios:lifecycle`, iPhone17/iOS27, cuatro procesos XCTest;
  informe `reports/ios-local/lifecycle-result.json` = `passed`, ejecución
  `reports/ios-local/run-A0EUs2` con `.xcresult`, resultados JSON y capturas.
- [x] **Android4/4:** `test:android:lifecycle`, AVD `noqueue-api36`/API36,
  cuatro PID distintos, WebView y Keystore reales; informe
  `reports/android-local/lifecycle-result.json` = `passed`, capturas `lifecycle-*.png`.
- [x] **Alta:** cuatro turnos por plataforma (2 restaurante+2 piscina), creados
  mediante formularios reales sin teléfono/WhatsApp. Identidad estable y0
  intenciones pendientes en todas las fases; Android mantiene vault cifrado.
- [x] **Llamado:** comandos reales del coordinador con actor local autorizado;
  restaurante `call`, piscina `assign_next`. Al reabrir se recuperan las cuatro
  capabilities originales, versión1, plazo de llegada futuro y «¡Es tu turno!».
- [x] **Atendido:** `complete` sobre uno por servicio da `completed` en D1 y fase
  cliente `arrived`, hora de llegada y «Se ha confirmado tu llegada», versión2.
  No se fuerza el estado legado `served`: `release` está retirado.
- [x] **Caducado:** el otro turno de cada servicio llega a `expired`, versión2,
  con UI «ha expirado». Gracia de fixture2 minutos reales, mantenimiento real
  del coordinador; sin modificar reloj ni escribir estados/plazos con SQL.
- [x] **Recuperación terminal:** primer reinicio tras transiciones y otro reinicio
  adicional conservan identidad y los cuatro estados. Lista de activos vacía;
  enlaces previamente conocidos siguen devolviendo200 al propietario,
  404 a otra instalación y401 sin identidad. Sin botones operativos y cancelar
  un terminal devuelve409 sin cambiar versión ni resucitarlo.
- [x] **D1 final por plataforma:**2 `completed` +2 `expired`, uno de cada estado
  por servicio;4 asociaciones,0 contactos,0 consentimientos y0 outbox WhatsApp.
- [x] **Aislamiento:** control Node local opt-in, token aleatorio privado0600 y
  solo fixtures conocidos. Cuatro pruebas HTTP sin token/con token inválido
  rechazadas404. No se añade endpoint de control al Worker ni al bundle App.
- [x] **Regresión focalizada:**43 tests API (móvil, cliente y acciones staff),
  37 web (CustomerTurn/RestaurantForm/MobileAdmission),13 tooling; typecheck
  mobile/E2E, sintaxis Node, proyecto Xcode y `git diff --check` correctos.

**Qué significa recuperar:** «Tus turnos» lista solo `waiting`/`called`, no un
historial de finalizados. Para verificar enlaces conocidos después de cerrar
la app, XCTest usa un registro **de prueba** Keychain separado, device-only y
no sincronizable, eliminado al terminar; Android conserva esos enlaces solo
en RAM del runner. Checkpoints e informes solo guardan hashes/estados/PID,
no secretos ni capabilities. No se implementa recuperación entre dispositivos.

**Ajustes de pruebas:** el primer intento usó llamada individual para piscina y
recibió409 `unsupported_action`; se corrigió el controlador a `assign_next` y se
repitió la suite iOS completa con D1 limpio. La primera invocación web omitía
`jsdom`; se repitió con el script oficial del paquete,37/37. No hubo que cambiar
código de producto ni flujo web. Las capturas de llamado/llegada confirmada se
revisaron visualmente; las tres pantallas se comprobaron por DOM en ambas apps.

**Límites/pendientes:** no se repiten aquí suites completas ni actualización/
corrupción. Continúan pendientes UI staff end-to-end, carreras simultáneas,
hardware real, otras versiones OS, push real/background, QR/discovery y staging
cuando se autorice. No hay despliegue, migración remota ni publicación en stores.
Reproducción y límites de almacenamiento en `docs/runbooks/mobile-local.md`.

Cierre verificado: API local detenida, iOS dedicado Shutdown, Android dedicado
cerrado, `adb reverse` retirado y archivo del token de control eliminado. Se
conservan las identidades ficticias y evidencias privadas; ningún artefacto local
es distribuible mientras apunte a loopback.

## Registro — cierre bloque1 local y primer tramo push (20/10/2026)

**Decisión del usuario:** bloque1 dado por validado en local. La matriz inicial
separa cobertura compartida web/backend de integración móvil. Hardware y staging
siguen siendo gates posteriores; no se reabre el bloque1 ni se repite toda la
matriz manual web en cada plataforma.

### Implementado en esta iteración

- Registro/revocación por instalación, tokens cifrados, rotación y resolución
  autorizada de avisos. Migración aditiva0030 aplicada únicamente en DB efímera
  de tests. Sin contactos, consentimientos ni envíos WhatsApp nuevos.
- Outbox transaccional para llamada/caducidad/cancelación, dispatcher serializado,
  TTL, descarte de obsoletos, reintentos acotados y adaptadores APNs/FCM con mocks.
- Controles de permiso voluntarios, listeners, refresco/resume y apertura segura;
  callbacks/entitlements iOS y canal Android preparados. Web no monta el proveedor.
- Flags servidor/build **OFF por defecto**. Sin credenciales reales ni archivo
  Firebase nuevo. No se ha probado ni declarado entrega push real.

### Validación ejecutada

- [x] API completa: **60 archivos /726 tests** correctos (incluye13 de registro,
  outbox/dispatcher y9 de adaptadores con transporte simulado).
- [x] Web completa: **67 archivos /617 tests** correctos (incluye11 del controlador
  push y4 de su integración UI; flujo web/WhatsApp conserva regresión).
- [x] Contratos: **15 archivos /89 tests** correctos.
- [x] Tooling móvil: **15 tests** correctos; defaults OFF y entitlements acotados.
- [x] Typecheck API, web, contratos, mobile y E2E correcto; ESLint focalizado en
  archivos web modificados, `plutil` y `git diff --check` sin errores.
- [x] Build web y copia Capacitor a ambos targets correctos. Build iOS Debug
  `iphonesimulator`, sin firma: **BUILD SUCCEEDED**. Android `assembleDebug`,
  TLS local opt-in: **BUILD SUCCESSFUL**.

Los builds usan `VITE_API_URL=https://127.0.0.1:8788` y push desactivado: **no son
artefactos distribuibles**. En esta iteración no se arrancaron simuladores ni se
repitieron las suites nativas del bloque1. Compilar no equivale a probar permiso,
recepción o apertura de una push real en background/cold start.

**Incidencias resueltas:** los tests workerd detectaron que `redirect:error` no se
soporta; el transporte usa `manual` y rechaza respuestas no exitosas sin seguir
redirecciones. Una invocación inicial Android apuntó al directorio padre de la CA;
se corrigió a `reports/android-local/tls/res` y el build final pasó. Advertencias
no bloqueantes API: sourcemaps de dependencia y lectura de body form-urlencoded
por el mock OAuth. No se ocultaron fallos ni se alteró el flujo web para pasar tests.

**Pendiente explícito del bloque2:** proximidad/cambios de estimación, configuración
real por entorno, viabilidad/negociación HTTP/2 APNs desde Workers, limitación de
permisos Android<=12, entrega física/background/cold start y política operativa.
Ver `docs/runbooks/mobile-push.md`. No se ha desplegado, migrado una base remota,
activado push, enviado avisos externos, firmado Release ni publicado en stores.

Logs de esta iteración en `/tmp/noqueue-push-full-api.log`,
`/tmp/noqueue-push-full-web-final.log`, `/tmp/noqueue-push-contract-tests-final.log`,
`/tmp/noqueue-push-tooling-final.log`, `/tmp/noqueue-push-ios-build-final.log` y
`/tmp/noqueue-push-android-build-final.log` (evidencia local temporal).

## Registro — credenciales limitadas y configuración nativa (20/10/2026)

Autorización explícita para configurar proveedores y crear claves restringidas,
**sin despliegue, publicación ni notificaciones reales**.

### Completado

- [x] Apple: App ID `com.noqueue-app.ios`, descripción NoQueue, Push habilitado,
  team LUMOSA `6VYYNUZPSH`. `com.noqueue.app` fue rechazado por Apple como no disponible;
  Android conserva ese ID. No se añaden capacidades no necesarias.
- [x] APNs: claves separadas `33FG9322FT` Sandbox y `W666TVNM38` Production,
  cada una limitada al único topic `com.noqueue-app.ios`. Sin DeviceCheck ni otros servicios.
- [x] Descarga y custodia fuera de Git: `/Users/usuario/.config/noqueue/push/`,
  directorio0700/archivos0600. No aparecen en bundles, `.dev.vars`, logs ni chat.
- [x] Firebase: Android NoQueue registrado en `nq-app-f3127`,
  ID `1:54689871019:android:fd8fe3f8c5fdb49cbf73ee`. HTTPv1 ya estaba habilitado.
  Configuración cliente descargada e instalada localmente; ignorada por Git.
- [x] Manifest Android: auto-init FCM OFF y Analytics desactivado; se verifica en
  el APK, no solo en código fuente. No se añade SDK Analytics.
- [x] Xcode team/bundle ID definitivo y pruebas/runner actualizados. Scripts
  Capacitor separan copy/sync por plataforma para no exportar un appId incorrecto.
  Añadidos tipos Node de desarrollo; lockfile solo incorpora esa dependencia móvil,
  sin aceptar la re-resolución de peers web que propuso pnpm.
- [x] Verificación local:17/17 tests tooling, typecheck mobile/E2E, `plutil`,
  `git diff --check`; firma/verificación offline P-256 de ambas claves privadas.
- [x] Compilaciones Debug Android e iOS simulador sin firma correctas. Configuración
  copiada por plataforma y bundle ID de Info.plist comprobados.

### Bloqueos y siguientes pasos

- [ ] **FCM servidor:** cuenta `noqueue-push-sender@nq-app-f3127.iam.gserviceaccount.com`
  creada, pero sin permisos asignados ni clave privada. Johan es Editor; no puede
  crear el rol personalizado ni ejecutar `resourcemanager.projects.setIamPolicy`.
  Alberto figura como propietario. Un administrador debe crear/asignar el rol
  `noqueueFcmSender` con **solo** `cloudmessaging.messages.create`; definición en
  `docs/runbooks/noqueue-fcm-sender-role.yaml`. Generar la clave después del grant.
- [ ] Copia de seguridad de las `.p8` en el gestor de secretos de la organización.
  No se subieron automáticamente a terceros; Apple solo permite una descarga.
- [ ] Certificado/perfil iOS con Push para dispositivo físico y validación del bundle
  definitivo. Cambiar ID crea otra aplicación: no se promete migración del Keychain
  del bundle antiguo de simulador ni se han borrado sus datos.
- [ ] App Store Connect muestra acuerdo pendiente del Account Holder; no aceptado.
  No se crea ficha de store ni se decide nombre público de empresa en esta iteración.
- [ ] Transporte HTTP/2 APNs, entrega/background/cold-start y demás pendientes bloque2.

No se ha conectado el backend a las claves reales, obtenido OAuth de proveedor,
instalado/arrancado apps, enviado push ni realizado migraciones remotas. Defaults
push siguen OFF. No se repiten suites completas web/API porque no cambió su código;
se conserva la evidencia de la iteración anterior, no se presenta como nueva ejecución.

Runbook actualizado: `docs/runbooks/mobile-push.md`. Evidencia visual privada en
`reports/push-setup/` (claves creadas, app Firebase e IAM); compilaciones y tooling
registrados en `/tmp/noqueue-provider-*-final.log`.

### 20/10/2026 — bloque3: inicio, búsqueda y establecimientos (local)

**No desplegado; sin envíos ni cambios de IAM/credenciales.** Push y analítica
nativos OFF. Bloque1 no se reabre; se prueba la nueva integración de discovery.

Implementación:
- `/` ahora muestra discovery; `/search` permite texto, tipo de servicio,
  orden por espera y paginación compartidos; `/turns` conserva recuperación.
- Navegación Inicio/Mis turnos con idioma y áreas seguras, sin duplicar elementos
  `<main>`. Filtros en fila independiente en móvil para evitar ocultarlos tras el
  selector de orden. Las pantallas web conservan su composición.
- Enlace de cada resultado a su establecimiento, selección del servicio y alta
  anónima existentes. Volver desde establecimiento o servicio abierto directamente
  desde búsqueda conserva su consulta. Los retornos rechazan destinos externos.
- Endpoint móvil de búsqueda reutiliza contrato/motor, sin relajar Origin público
  ni incorporar WhatsApp; registro de identidad y tráfico siguen en HTTPS sin cookies.
- Datos sintéticos del harness incluyen ubicación confirmada y snapshot del
  directorio; no usa geocodificador ni datos externos. Outbound del Worker bloqueado.
- Runners antiguos de recuperación actualizados a `/turns`; escenarios nuevos
  solo en el bundle de tests, nunca dentro de los assets de la aplicación.

Evidencia:
- Cliente: **263/263** pruebas en 27 archivos (customer, transporte, Capacitor y
  privacidad), incluidos 13 casos nuevos de navegación/discovery nativos y
  regresión de búsqueda/fichas/formularios web.
- Worker/D1 local: **62/62** en mobile/discovery, incluidos 3 casos nuevos de
  equivalencia de catálogo web/móvil, autorización, CORS, validación y cuotas.
- Tooling nativo: **19/19**. Typechecks web/API/mobile/E2E correctos.
- Lint web sin errores; conserva 2 warnings anteriores ajenos a este bloque
  (`stepper` y `CreateEstablishmentDrawer`). Build Vite correcto; aviso de tamaño
  de bundle existente. Android Debug offline y Xcode Debug/LocalSmoke correctos.
- iOS, bundle definitivo `com.noqueue-app.ios`: `test19NativeDiscoveryAndAdmission`
  **1/1 passed**, ejecución `reports/ios-local/run-04oCbz`, resumen
  `reports/ios-local/discovery-result.json` y captura adjunta al xcresult.
- Android, `com.noqueue.app`: `reports/android-local/discovery-result.json` passed;
  capturas `discovery-home.png`, `discovery-search.png`, `discovery-venue.png`.
  Capturas Android e iOS inspeccionadas; sin desbordamiento horizontal de página.
- Cada simulador usó una DB efímera nueva: 1 turno móvil → cancelado, 1 asociación
  instalación–turno, **0** contactos/consentimientos/outbox WhatsApp y **0** registros
  o avisos push. No se solicitaron permisos de notificación ni hubo llamadas `/push`.
- El escenario DOM inicial pulsaba filtros antes de que React aplicara la búsqueda
  debounced; se corrigió esperando la respuesta de esa consulta, no los resultados
  globales anteriores. Dos intentos iOS y dos Android previos fallaron antes del
  alta; los resúmenes anteriores identifican únicamente las ejecuciones finales.

Límites: automatización sobre WebView nativo real con eventos DOM, no validación
manual del teclado/gestos/lectores de pantalla. Offline/reintentos y errores se
cubren en tests UI; no se declara una matriz física ni entrega push. QR/GPS,
Universal/App Links, UX de credenciales perdidas, firma y publicación pendientes.
Los assets y builds locales apuntan a loopback: **no distribuirlos**.


### 2026-10-20 — Corrección de paridad web y exclusividad móvil

Esta entrada **sustituye la aceptación de navegación/UI de la entrada anterior**,
no sus evidencias históricas. No hay «Inicio / Mis turnos», selector ni catálogo
extra. La web conserva su contrato y composición; la app reutiliza sus pantallas.

Implementado:
- Recuperación independiente de push antes de presentar altas, al volver a primer
  plano y al cambiar de ruta. El turno activo tiene prioridad sobre otro servicio
  o enlace antiguo. Error de red/almacenamiento no equivale a instalación sin turno.
- Migración0031 con preflight de duplicados y triggers transaccionales de asociación
  y reactivación. Conflicto409 devuelve solo referencia del propietario; suspensión
  falla cerrada sin revelar datos. Idempotencia se resuelve primero.
- Formularios compartidos sin teléfono/WhatsApp móvil, cronómetro sin regreso al
  catálogo activo, pantallas terminales conservadas y push secundario discreto.
- QR compartido con origen público permitido, cierre de cámara y ubicación mediante
  plugin nativo opt-in. Android12+ solo aproximada; en versiones anteriores el
  plugin requiere alias combinado (FINE limitado a maxSdkVersion30), sin background.
- Desactivado el desenfoque automático de bordes de WKWebView en iOS26+ que ocultaba
  la cabecera. No se ha rediseñado ningún componente web para solventarlo.

Evidencia de esta corrección:
- **289/289** pruebas cliente en 29 archivos; **71/71** API/Workers/D1 en 6 archivos;
  **21/21** tooling nativo. Incluye concurrencia entre colas/tenants, replay,
  estados terminales/reactivación, suspensión, recuperación, QR y permisos.
- Tipos web/API/mobile/E2E correctos. Lint web: 0 errores, 2 warnings preexistentes.
  Build Vite, Android Debug y Xcode LocalSmoke correctos; no builds de distribución.
- iOS: `reports/ios-local/run-WGmjHG`, tests19 (discovery/alta/recuperación/cancelación)
  y20 (ubicación simulada con plugin real) passed. Seis capturas en `attachments/`.
- Android: `reports/android-local/discovery-result.json` passed (21:20:20Z),
  `parity-01-home.png` a `parity-06-turn.png`; `capabilities-result.json` passed
  (21:19:40Z), stream de cámara abierto/cerrado y ubicación mediante proveedor de
  red de prueba, retirado al terminar. No es lectura óptica de QR físico.
- Referencias web: `reports/mobile-parity/web-result.json` passed (21:24:38Z),
  capturas `web-{android,ios}-01..06-*`, ES, viewports CSS412×839 y402×874.
  Revisados inicio, búsqueda, filtro, ficha, formulario y cronómetro. Se mantienen
  las diferencias permitidas (teléfono/WhatsApp solo web, sin volver en turno móvil).
  Son comparaciones de estructura/composición, **no una prueba pixel-perfect**:
  renderizado tipográfico del motor/SO, identificadores/horas de fixtures y orden
  de empates entre DBs efímeras varían. Cronómetro web usa fixture sintético de solo
  lectura del test Android; no se realizó un alta web ni se envió WhatsApp.
- Cada recorrido nativo: 1 turno móvil → cancelado, 1 asociación, 0 contactos,
  consentimientos, outbox WhatsApp, registros push y outbox push. Sin permisos push.

Pendientes explícitos: convertir y repetir suites nativas históricas que asumían
múltiples turnos (incluida actualización binaria y ciclo de estados), matriz de
permisos/SO antiguos, QR físico, Universal/App Links y QA táctil/accesibilidad.
Los tests unitarios/API actuales no sustituyen esas pruebas de integración.
No se han desplegado cambios, ejecutado migraciones remotas ni enviado avisos.
Los assets locales apuntan a loopback: **no distribuir**.


### 2026-10-20 — FCM: permisos comprobados y rol mínimo aplicado

Registro histórico: el pendiente de descarga se resolvió el21/10/2026 (entrada posterior).

Verificado IAM real tras recargar la sesión: Editor + Administrador de funciones
+ Administrador de IAM del proyecto. Creado/asignado `noqueueFcmSender` con un solo
permiso; clave única creada con nueva confirmación del usuario. **No confundir
clave creada con custodia verificada**: aún falta localizar el JSON descargado.
El comprobador sin entrega está preparado y probado (5/5); regresión push API22/22
y tipos correctos. Auto-init y push siguen OFF. Estado y pruebas reproducibles en
`docs/runbooks/mobile-push.md`. Sin despliegues ni notificaciones reales.


### 2026-10-21 — FCM: clave custodiada y autorizada sin entrega

- [x] Clave existente localizada en Downloads y movida fuera de Git al directorio
  privado de push; archivo0600, directorio0700, sin copia restante en Descargas.
- [x] Identidad del service account/proyecto/key ID y firma RSA local verificadas.
- [x] OAuth real y FCM HTTPv1 `validate_only: true` correctos; sin token de dispositivo,
  sin notificaciones reales ni registro de instalaciones. Evidencia sin secretos:
  `reports/push-setup/fcm-credential-validation.json` (07:56:55 Europe/Madrid).
- [x] Metadatos locales actualizados; push sigue OFF. No se han copiado secretos al
  repositorio, apps, `.dev.vars` o Workers ni desplegado cambios.
- [ ] Alberto retira los dos roles temporales de Johan, conservando Editor y el rol
  mínimo de la cuenta FCM. No se han cambiado permisos del usuario en este turno.

Quedan los gates de ejecución en entorno autorizado y entrega física de bloque2;
la validación de credencial no los sustituye. APNs HTTP/2/firma y staging siguen
pendientes. Sin migraciones remotas ni despliegues.

### 2026-10-21 — APNs e iOS: guardas y validación local sin entrega

- [x] Gate independiente `APNS_TRANSPORT_VERIFIED=false`: no activar iOS por tener
  claves o por habilitar FCM; registro y envío fallan cerrado, sin gastar intentos
  ni borrar tokens. Proveedores desconocidos se rechazan.
- [x] Diagnóstico APNs reutilizable: ambas claves P-256 y firma local correctas;
  conexión TLS1.3/HTTP2 a Sandbox y Production desde Node local, cero HTTP requests
  y sin enviar credenciales. No equivale a autorización APNs ni HTTP2 en Workers.
- [x] Test del runtime workerd confirma que `node:http2.connect` es stub. Mantener
  pendiente la solución/verificación del transporte real, sin introducir relay
  o Firebase iOS silenciosamente.
- [x] Capacidad Push declarada en Xcode y configuración Capacitor iOS sincronizada;
  foreground explícito sin alerta duplicada, solo refresco. Sin silent push ni
  permisos nuevos al inicio.
- [x] Auditoría resuelta Debug/Release/simulador, bundle y team correctos. Script
  preparado para cotejar un futuro artefacto firmado y su perfil; fixture con
  fechas/certificados, perfil caducado, team/bundle/entorno erróneos cubiertos.
- [x] Builds locales Release/iphoneos y Debug/iphonesimulator sin firma correctos;
  la app unsigned se rechaza como prueba de firma. Sin instalar ni arrancar apps.
- [x] Regresión API móvil56/56 (incluye push27/27), cliente push15/15, tooling33/33;
  tipos API/web/mobile y `git diff --check` correctos. Tests con claves sintéticas
  y proveedores simulados; diagnóstico de conexión separado sin mensajes.
- [x] Evidencia sin secretos en `reports/push-setup/apns-local-transport.json`,
  `apns-offline-validation.json`, `ios-push-configuration.json`, `ios-local-builds.json`.
- [ ] Resolver/verificar HTTP2 desde el Worker destino. El nuevo gate **no** lo
  implementa ni permite marcarlo listo con el probe de Node local.
- [ ] Firma/perfil de dispositivo, autorización APNs y pruebas físicas siguen
  pendientes. No validados por compilar ni por tener las claves.

Push sigue OFF; sin despliegues, migraciones remotas, notificaciones reales ni
cambios IAM. Los pasos reproducibles y límites figuran en `docs/runbooks/mobile-push.md`.

### 2026-10-21 — FCM iOS integrado, sin activación ni entrega

**Sustituye APNs directo como ruta activa.** El historial y sus pruebas HTTP/2 se
conservan, pero no se presentan como validación de FCM iOS ni como requisito de
un relay nuevo. Worker → FCM HTTPv1 → APNs → iOS; Android continúa usando FCM.

- [x] Puente iOS propio con SDK oficial FirebaseMessaging12.7.0 y registro FCM
  explícito; no reutiliza token APNs ni lo convierte a minúsculas.
- [x] Inicialización diferida con gate nativo + configuración + permiso; auto-init,
  swizzling y Analytics OFF. Sin Firebase Auth ni cambios de identidad anónima.
- [x] Rotación/deduplicación, revocación backend primero, callbacks tardíos y
  desmontaje durante readiness/start probados con dobles de proveedor.
- [x] Capacitor mantiene permisos/recepción/apertura; UI/turno único/web sin cambios.
- [x] Backend FCM iOS con payload APNs, gate independiente OFF y contrato explícito.
- [x] Migración0032 preparada y probada en fixtures: plataforma separada; APNs legacy
  se retira sin afectar identidad, turnos, Android o avisos aceptados. **No aplicada
  a bases persistentes ni remotas.**
- [x] Build sin plist cliente permitido con push apagado; protección contra copia
  obsoleta/proyecto erróneo y validación de configuración antes de iniciar SDK.
- [x] API móvil61/61; web667/667; contratos push2/2; tooling29/29 (incluye lifecycle
  Swift23 aserciones); tipos API/web/mobile/contracts y build web correctos.
- [x] iOS Debug/simulador compila y smoke XCTest1/1 confirma Firebase sin inicializar
  y Keychain sin modificaciones por el puente apagado. Simulador detenido después.
- [x] iOS Release/iphoneos sin firma y Android Debug compilan localmente.
- [x] Auditoría Xcode verifica gates OFF, bundle/team/entitlements y configuración
  cliente ausente. No se infiere entrega ni firma real de estas pruebas.
- [x] Registrar app Firebase iOS `com.noqueue-app.ios` / NoQueue iOS, ID `1:54689871019:ios:bf4f2ec894b1aa99bf73ee`, team `6VYYNUZPSH`.
- [x] `GoogleService-Info.plist` localizado en Downloads, validado e instalado en el proyecto iOS (0600, ignorado por Git). Dos descargas idénticas, conservadas.
- [x] APNs configurado en Firebase tras confirmación: claves existentes de Sandbox y Production en sus respectivos apartados; sin crear nuevas claves.
- [ ] Revisar declaraciones de privacidad del SDK/identificador Firebase Installations.
- [x] Firma/perfil de desarrollo validados e instalación física el 21/10 (detalle al final).
- [ ] Pruebas físicas push: token real, renovación, denegación/revocación,
  foreground/background/cold-start y apertura del turno. Entrega no validada.
- [ ] Despliegue/migraciones/activación y smoke staging solo con autorización aparte.

Evidencia: `reports/push-setup/fcm-ios-local-validation.json`,
`fcm-ios-configuration.json`, logs `/tmp/noqueue-fcm-*` y runbook actualizado.
**Sin desplegar, subir o utilizar claves reales, enviar avisos ni activar gates.**
Los artefactos apuntan a API loopback, no son builds distribuibles.

### 2026-10-21 — Registro Firebase iOS y preparación de APNs (histórico parcial; resuelto abajo)

- [x] App iOS registrada una sola vez en `nq-app-f3127`, bundle `com.noqueue-app.ios`,
  alias NoQueue iOS, App ID `1:54689871019:ios:bf4f2ec894b1aa99bf73ee`.
- [x] Team ID `6VYYNUZPSH` guardado y verificado en consola. App Store ID no inventado.
- [x] FCM HTTPv1 permanece habilitado; la consola muestra espacios separados para
  claves APNs de desarrollo y producción. Ninguna clave cargada todavía.
- [ ] Confirmación de delegación a Firebase antes de subir ambas claves existentes;
  diálogo de desarrollo preparado, no se ha seleccionado ni transmitido el P8.
- [ ] Configuración cliente: botón de descarga solicitado, sin evento de descarga
  ni archivo localizado en Downloads; se ha pedido ruta al usuario. No se crea un
  plist manual ni se copia una credencial de servicio como sustituto.

Push sigue OFF. No se han desplegado cambios, enviado avisos ni aplicado
migraciones. Evidencia: `reports/push-setup/firebase-ios-registered.png` y
`firebase-apns-upload-pending.png`. Este registro parcial no valida entrega.

### 2026-10-21 — Firebase iOS y APNs configurados, push sigue OFF

Resueltos los pendientes del registro parcial anterior:

- [x] Usuario confirmó subir ambas claves existentes a Firebase y habilitó el
  permiso de archivos de la extensión Chrome que impedía la carga.
- [x] Clave de desarrollo `33FG9322FT` y de producción `W666TVNM38` guardadas y
  visibles en Cloud Messaging de NoQueue iOS (`com.noqueue-app.ios`, team
  `6VYYNUZPSH`, proyecto `nq-app-f3127`). No se crean ni amplían claves/IAM.
- [x] Descargas `GoogleService-Info.plist` y `(1)` localizadas: idénticas y con
  proyecto/bundle/sender/App ID correctos. Configuración instalada en
  `apps/mobile/ios/App/App/GoogleService-Info.plist`, 0600 y excluida de Git.
- [x] Auditoría offline automatizada de configuración cliente sin imprimir API key.
- [x] Tooling30/30, build web y sync iOS correctos. iOS Debug/simulador y
  Release/iphoneos sin firma compilan con el plist real incluido.
- [x] XCTest22 1/1 con configuración real: Firebase no inicializado, start rechazado
  por gate OFF y vault Keychain sin cambios. Simulador detenido al terminar.
- [x] Bundles Debug/Release cotejados: plist coincide, gates/auto-init/swizzling
  apagados, Analytics desactivado y ningún `.p8` incluido.
- [ ] Validar autorización/entrega APNs real a través de FCM, token/rotación,
  background/cold-start en dispositivo físico firmado y staging autorizado.

No se ha desplegado, migrado una base remota, solicitado un token FCM real ni
enviado notificaciones. La subida de claves **no equivale a entrega validada**.
Identidad anónima, alta/turno y UI intactos; no se cambia Android. Configuración
cliente no es una clave privada de servicio y no activa el SDK por sí sola.

Evidencia: `reports/push-setup/firebase-apns-configured.png`,
`firebase-ios-console-validation.json` y `firebase-ios-client-audit.json`.
Logs `/tmp/noqueue-firebase-ios-*` y `/tmp/noqueue-firebase-config-tests.log`.

### 2026-10-21 — Firma de desarrollo e instalación en iPhone físico

- [x] iPhone 14 Pro Max/iOS27.0.1 detectado por Xcode27.1 mediante cable;
  emparejado y Developer Mode habilitado. No se alteran ajustes de seguridad.
- [x] Firma automática configurada para LUMOSA (`6VYYNUZPSH`), bundle
  `com.noqueue-app.ios`, Debug/APNs development y Release/APNs production.
- [x] Intento real de build Debug dirigido al iPhone, sin permisos de provisión
  remota: falla por ausencia de perfil iOS App Development. No se declara firmado.
- [x] Bloqueo identificado: Apple Accounts de Xcode vacío y 0 identidades de firma
  válidas en el llavero. Pantalla de inicio de sesión abierta y solicitada al usuario.
- [x] Auditor ampliado con `--device`: exige perfil development depurable que incluya
  el dispositivo exacto; salida sin UDID. Tooling **31/31**, tipos mobile y auditoría
  de ajustes Debug/Release/simulador correctos; Firebase y push OFF.
- [x] Usuario inició sesión en Xcode: LUMOSA visible con acceso a Certificates,
  Identifiers & Profiles. Sin certificados ni dispositivos provisionados todavía.
- [x] Usuario confirmó crear firma/registro/perfil. Xcode creó certificado Apple
  Development con clave privada en el llavero del Mac y perfil de LUMOSA para
  `com.noqueue-app.ios`, incluyendo el iPhone. Sin exportar claves ni revocar otros.
- [x] Build Debug firmado **BUILD SUCCEEDED**. Perfil `iOS Team Provisioning Profile:
  com.noqueue-app.ios`, caducidad 21/10/2027 11:56:35 UTC. Auditor verifica integridad,
  bundle/team, APNs development, perfil depurable e inclusión del dispositivo.
- [x] Instalación física correcta y app abierta, verificada visualmente en Device
  Hub. No había instalación previa detectada; no se desinstala ni borra Keychain.
- [x] Bundle auditado: Firebase cliente coincide, gates/auto-init/swizzling/Analytics
  OFF y sin P8 incluidos. No se solicita permiso de notificaciones ni token real.
- [x] Alta/recuperación/persistencia física: validadas posteriormente con HTTPS LAN
  y UI asistida por el usuario; evidencia ampliada abajo.
- [x] Corregir safe area de cabecera en recuperación: viewport nativo corregido
  el 21/10 y verificado en iPhone físico (validación ampliada abajo).
- [x] Endpoint HTTPS efímero accesible desde el iPhone usando IP privada del Mac
  y CA temporal confiada por el usuario; nunca producción como alternativa.

Guía reproducible: `docs/runbooks/mobile-local.md`, sección iPhone físico.
Evidencia local: `/tmp/noqueue-physical-ios-signing.log`,
`/tmp/noqueue-physical-ios-settings.json`, `/tmp/noqueue-physical-ios-tooling.log`.
Evidencia final: `/tmp/noqueue-physical-ios-provisioning.log`,
`/tmp/noqueue-physical-ios-signed-audit.json`, instalación/arranque en
`/tmp/noqueue-physical-ios-install.json` y `-launch.json`, captura
`reports/push-setup/ios-physical-signed-launch.png` (ignorada por Git).
Credencial/perfil de desarrollo creados con confirmación expresa; esto **no es**
una publicación en App Store/TestFlight. Sin despliegues backend, migraciones ni
notificaciones. Push sigue OFF; código de identidad/UI y Android intactos.


### 2026-10-21 — HTTPS local, live reload y safe area (smoke físico completado)

- [x] Investigación oficial Capacitor/Ionic: servidor LAN + `server.url` temporal;
  CSS `env(safe-area-inset-*)` y `viewport-fit=cover` suficientes en iOS. Sin plugin nuevo.
- [x] Viewport opt-in solo native antes de React, top/laterales con insets dinámicos;
  viewport web intacto. Cabecera de recuperación verificada debajo de la barra de
  estado en iPhone14ProMax después de actualizar sin desinstalar.
- [x] API efímera opt-in interfaz IPv4 privada, HTTPS validado, fixtures sintéticas,
  D1 local, salidas bloqueadas y push/WhatsApp OFF; loopback por defecto preservado.
- [x] CA temporal7d y certificado SAN para IP del Mac, claves ignoradas por Git;
  usuario confirma instalación temporal. No se instala confianza automáticamente.
- [x] Servidor de descarga solo certificado público, 404 para otros archivos y
  caducidad15min; sin directorio/claves expuestos.
- [x] Vite HTTPS/HMR preparado; proxy local valida CA y conserva autenticación
  móvil (401 sin identidad). Worker CORS productivo intacto.
- [x] Live reload doble opt-in, iOS-only, HTTPS/IP privada/puerto5173 y guard de
  build que impide empaquetarlo fuera de Debug.
- [x] Regresión web670/670, API móvil61/61 y tooling34/34; tipos mobile correctos.
  Build iOS Debug firmado con cabecera corregida instalado encima de la app previa.
- [x] Usuario instaló el perfil y activó por separado la confianza de CA: HTTPS real
  funcional en el iPhone14ProMax (iOS27.0.1).
- [x] Alta restaurante desde UI física asistida por el usuario: turno `5DSNRT`,
  exactamente1 entrada waiting y1 asociación móvil. Cero contactos, consentimientos,
  WhatsApp, registros push y outbox push. No se leyó ni expuso el secreto Keychain.
- [x] Reinicio frío recupera el mismo turno; instalar Debug live encima también lo
  recupera: evidencia funcional de continuidad de la identidad, sin desinstalar.
- [x] HMR real: un borde CSS temporal apareció en la cabecera sin recompilar ni
  reinstalar; retirado después. Configuración fuente restaurada sin `server.url`.
- [x] Cancelación por UI asistida del iPhone: pantalla «Ya no estás en la lista de
  espera» y API con1cancelled/0activos; sin contactos, consentimientos ni avisos.
- [x] Bundle normal reinstalado encima, sin `server.url` en el artefacto instalado.
  Arranque frío muestra inicio, no recupera el turno cancelado. Firma auditada y
  gates push OFF. Vite detenido tras comprobar HMR.
- [x] Campo Nombre enfocado y texto escrito con teclado real abierto: cabecera visible
  sin solapamiento ni ampliación observable (`06-keyboard.png`). Mínimo16px solo
  native, sin bloquear pinch zoom ni cambiar web. Regresión final web670/670.
- [x] Envío después de foco/escritura/cierre de teclado en hardware: nuevo turno
  `DDGBG8`, cabecera correcta y sin zoom residual observable. API con2 entradas:
  1cancelled y1waiting (solo1activa); contactos/consentimientos/avisos siguen en0.
  Evidencia `07-rejoined-after-keyboard.png` y `/tmp/noqueue-physical-rejoined.json`.
- [x] Giro físico a horizontal: cabecera y controles respetan los márgenes laterales
  con isla dinámica a la derecha (`08-landscape.png`); sin solapamiento observado.
- [x] Usuario confirma prueba de scroll/cancelación y regreso a vertical; pantalla
  final observada. API:2cancelled/0activos, contactos/consentimientos/avisos0.
  Evidencia `09-final-cancelled.png`, `/tmp/noqueue-physical-final-evidence.json`.
  La validación horizontal pasa a ser histórica: el requisito ahora es portrait.
- [x] Cierre: API/Vite/servidor de certificado detenidos tras finalizar pruebas.
- [ ] Usuario retira el perfil/confianza «NoQueue local development» cuando no vaya
  a seguir probando; no modificar su confianza automáticamente.

Guía: `docs/runbooks/mobile-local.md`, sección HTTPS LAN/live reload.
No despliegues, migraciones remotas, tokens FCM ni notificaciones reales.

Evidencias físicas: `reports/ios-device/01-home-safe-area.png`, `02-recovered.png`
y `03-live-hmr.png` (borde temporal de diagnóstico, no diseño final), ignoradas por
Git. Contadores sin secretos: `/tmp/noqueue-physical-joined.json` y
`/tmp/noqueue-physical-recovered.json`. UI táctil asistida por el usuario; Device Hub
se usó para observación, no se atribuye automatización de taps que no funcionó.

Evidencia de cierre del turno: `reports/ios-device/04-cancelled.png`,
`05-normal-after-cancel.png`, `/tmp/noqueue-physical-cancelled.json`.
Build final firmado correcto (`/tmp/noqueue-physical-final-build.log`), auditoría
firmada (`/tmp/noqueue-physical-final-audit.json`), tooling34/34 y tipos mobile;
viewport/admisión11/11 tras protección de campos nativos.

### 2026-10-21 — Orientación exclusivamente portrait (decisión posterior)

- [x] Usuario solicita que la app no gire: sustituye el objetivo anterior de admitir
  orientación horizontal; conservar sus capturas solo como evidencia histórica.
- [x] iOS declara únicamente `UIInterfaceOrientationPortrait` para iPhone/iPad.
  `UIRequiresFullScreen` activa compatibilidad iPad; sin plugin ni cambios web.
- [x] Android MainActivity declara `screenOrientation="portrait"` y opt-out de
  compatibilidad API36 para conservar escena vertical en pantallas grandes.
- [x] iOS Debug firmado y Android Debug offline compilan. Plist empaquetado solo
  Portrait; APK MainActivity screenOrientation=1 y propiedad API36 verificadas.
  Tooling36/36 y tipos mobile pasan; auditoría de firma/gates OFF correcta.
- [x] Usuario gira el iPhone a ambos lados y confirma que sigue vertical; Device Hub
  muestra dispositivo horizontal con escena portrait sin rotar. Evidencia
  `reports/ios-device/10-portrait-locked.png`. Instalado encima sin borrar identidad.
- [x] Validación runtime Android teléfono API36 completada (smoke abajo).
- [ ] Validación iPad/tablets/plegables/pantallas grandes: no extrapolar los teléfonos.

Límites del SO: iPadOS moderno puede presentar una escena portrait en una ventana;
Android puede rotar el display y encajar la escena. En pantallas Android >=600dp,
el opt-out desaparece al target37: revisar compatibilidad antes de subir target,
no prometer bloqueo universal ni forzar restricciones con hacks CSS/JavaScript.
Fuentes: [Capacitor](https://capacitorjs.com/docs/guides/screen-orientation),
[Apple](https://developer.apple.com/documentation/bundleresources/information-property-list/uirequiresfullscreen),
[Android](https://developer.android.com/develop/adaptive-apps/guides/app-orientation-aspect-ratio-resizability).

Logs portrait: `/tmp/noqueue-portrait-ios-build.log`,
`/tmp/noqueue-portrait-ios-audit.json`, `/tmp/noqueue-portrait-android-build.log`,
`/tmp/noqueue-portrait-android-manifest.txt`, `/tmp/noqueue-portrait-tooling.log`.
Esta app Debug conserva API local; con el servidor detenido no tendrá conexión.
No usar el artefacto local para distribución. Sin despliegues ni avisos reales.

### 2026-10-21 — Android portrait + regresión de turnos (validado local)

- [x] APK Debug con configuración portrait, API loopback HTTPS y CA exclusiva Debug;
  instalado con `adb install -r` en AVD existente `noqueue-api36`, sin borrar Keystore.
  Web build y APK compilan; push/Analytics/WhatsApp OFF, salidas API bloqueadas.
- [x] Runner dedicado `test:android:portrait` usa WebView/bridge/Keystore reales y
  navegación actual (recuperación directa, sin «Mis turnos»).
- [x] Control positivo: Ajustes Android gira realmente90° antes de abrir NoQueue,
  descartando un emulador globalmente bloqueado como falso positivo.
- [x] **64 comprobaciones** solicitando90°,270°,180°,0°: la app declara
  `SCREEN_ORIENTATION_PORTRAIT`, rotación efectiva0 y viewport412×839 portrait.
  Cubre inicio, formularios, cronómetros, recuperación, diálogo y estado cancelado.
- [x] **Restaurante, piscina y recepción**, secuencialmente: alta201 por UI sin
  teléfono/WhatsApp, mismo turno recuperado automáticamente tras force-stop/nuevo
  PID (sin navegar artificialmente al turno) y misma identidad nativa por digest.
- [x] Cancelación200 desde diálogo UI, pantalla final conservada; nuevo arranque
  vuelve al inicio. Nueva alta posterior permitida, sin turnos activos simultáneos.
- [x] DB final:3entradas/3asociaciones, **3cancelled y0activos**. Cero contactos,
  consentimientos, WhatsApp, registros/outbox push y peticiones push/externas.
- [x] Tooling37/37 y tipos mobile/e2e correctos. `git diff --check` sin errores.
- [x] Giro de usuario restaurado a `free`; forward/reverse ADB retirados por runner.
- [x] API efímera y emulador iniciados para este smoke cerrados; datos del AVD
  conservados, sin desinstalar ni borrar Keystore.

Evidencia: `reports/android-local/portrait/result.json` y capturas por servicio/fase
(ignoradas por Git); `/tmp/noqueue-android-portrait-smoke.log`, `-apk-build.log`,
`-tooling.log`, `-e2e-types.log`. Se conservó `result-startup-race.json` de un intento
fallido del runner: consulta PID demasiado pronto. Corregida espera acotada de
PID/socket; repetición completa sobre API nueva **PASS**, sin fallo nativo de app
observado. Esta evidencia no valida Android físico, tablet, plegable ni target37.
Sin despliegues, migraciones remotas, tokens ni notificaciones reales.


### 2026-10-21 — Push real local, limitado al iPhone (entrega y apertura validadas)

- [x] Autorización explícita del usuario: avisos de prueba **solo a su iPhone**,
  sin despliegues. No se extiende a otros destinatarios, campañas ni WhatsApp.
- [x] Harness separado del determinista: DB efímera, HTTPS LAN, credenciales fuera
  Git, controles loopback con bearer, sin bindings/migraciones remotas.
- [x] Restricción de destinatario y presupuesto atómico de un intento antes del
  envío; pin de propietario/token/turno, rechazo de broadcasts y destinos ajenos,
  caducidad de autorización y bloqueo de reenvíos automáticos incluso por timeout.
- [x] Compilación web local push ON/Analytics OFF; build iOS Debug firmado,
  entitlement development y perfil de ese iPhone auditados. Instalación encima,
  sin desinstalar ni borrar Keychain, sin live reload. Fuente nativa sigue OFF;
  opt-in solo en configuración generada/ignorada de este artefacto.
- [x] Alta anónima física `C9NKZ3` y registro FCM iOS único; usuario confirma
  «Desactivar avisos». DB:1entrada/1asociación, cero teléfono/consentimientos/WhatsApp.
- [x] Llamada real del coordinador → outbox → OAuth/FCM **accepted**,1intento
  el21/10 a14:45:43UTC. Turno called/version1; presupuesto restante0, OAuth restante0.
  Esto acredita aceptación del proveedor, no recepción ni apertura humanas.
  Usuario confirma que tenía la app abierta: no vio banner (presentación en
  foreground deshabilitada por diseño); no dar recepción/apertura por validadas.
  Primera sesión desarmada; evidencia conservada en `push-real/first-foreground/`.
  Segunda sesión nueva: se esperó confirmación explícita de teléfono bloqueado
  antes del siguiente envío, también limitado al mismo iPhone.
- [x] Segundo intento con H6RZ76: usuario confirma previamente «teléfono bloqueado».
  FCM accepted/1attempt a14:50:37UTC; aviso NoQueue visible en Device Hub.
  Evidencia `reports/ios-device/push-real/02-lock-notification.png`.
- [x] Usuario pulsa la notificación y confirma «listo»: API registra1resolución de
  notice200, seguida de lecturas del turno; pantalla «¡Es tu turno!» H6RZ76.
  Evidencia `03-opened-turn.png` y `progress.json`; no navegación artificial
  ni lectura de secretos/capabilities para hacer pasar la prueba.
- [x] Tests API37/37 (6del filtro más provider/outbox), tooling mobile37/37,
  regresión web670/670, tipos API, builds web/iOS y `git diff --check` correctos.
  Los tests automatizados usan red simulada; no suman envíos reales.
- [x] Cierre: emisor desarmado y registro temporal eliminado (0registros, outbox
  accepted conservado). Bundle OFF web/nativo recompilado, firmado y reinstalado
  encima; recupera H6RZ76 sin borrar identidad y sin CTA push (`04-restored-off-same-turn.png`).
  API detenida; puertos8788/8789 sin listeners. Config privada temporal y bearer
  de control retirados; credencial original fuera Git conservada.
- [x] Informe final `reports/ios-device/push-real/result.json`; primera ejecución
  separada en `first-foreground/result.json`. **2envíos reales en total, ambos
  al mismo iPhone**, sin reintentos automáticos ni otros destinatarios.
- [ ] Retirar perfil/confianza CA local cuando no se siga probando (acción del usuario).

La prueba no acredita TestFlight/APNs distribución, Android real, rotación de token,
ni entrega en todos los estados del SO. No marcar esas pruebas por extrapolación.
Runbook: `docs/runbooks/mobile-push.md`, apartado smoke real autorizado.

## Checkpoint Git y preparación de PR — 2026-10-21

Este checkpoint conserva el trabajo móvil validado, **no autoriza una publicación**.
El flujo web se mantiene por contrato y regresión, no por ausencia de cambios:
esta rama sí modifica componentes compartidos, API y migraciones.

- [x] Trabajo trasladado a worktree independiente, rama `codex/mobile-validation`,
  desde `03fcd352b9e4c204c1621c900823a98a6789e0d4`; comparación SHA-256 de los
  142 archivos originales y copia privada de recuperación antes de limpiar el
  checkout original. Evidencias físicas y configuración local permanecen fuera Git.
- [x] Revisión previa de identidad/vault, exclusividad transaccional, idempotencia,
  adaptadores web/native, autenticación del turno, gates push y harness local.
- [x] Corregida integración de tests: las pruebas CLI `node:test` de APNs/FCM se
  ejecutan separadas de Vitest/workerd y quedan incluidas explícitamente en CI.
- [x] Añadido `VITE_MOBILE_PUSH_ENABLED` a las variables de build de Turbo y
  regresión para que una compilación OFF no se confunda con una opt-in.
- [x] Repositorio público: auditoría Gitleaks 8.30.1 sobre el árbol candidato,
  sin credenciales reales detectadas. Dos alertas revisadas son expresiones que
  generan PEM efímeros en tests con `crypto.subtle.generateKey`, no claves
  almacenadas. Sin exclusiones generales para ocultar hallazgos.
- [x] Configuración Firebase local, `.dev.vars`, claves APNs/FCM, certificados,
  perfiles, evidencias de dispositivo y artefactos de build excluidos del commit.
- [x] Auditoría remota de solo lectura: GitHub no tiene webhooks y el único
  workflow es CI (`pull_request` y push a `main`), sin pasos de despliegue.
  Cloudflare muestra cuatro Workers (API production/staging/sandbox y landing),
  ninguno con repositorio conectado en Settings → Builds. No hay proyectos Pages.
  Push de esta rama y apertura de PR no configuran ni ejecutan un despliegue.
- [x] Instalación limpia con lockfile congelado; tipos, lint, tests de preparación
  de producción y `production:check` correctos. Lint conserva dos avisos previos
  de React Hook Form, sin errores.
- [x] Regresión unitaria: web 670, contratos 89, privacidad 12, landing 5;
  tooling mobile 38 y herramientas APNs/FCM 9, todos correctos y sin red real push.
- [x] Build completo y artefactos de producción OFF/WhatsApp OFF en dry-run,
  sin publicar. En este Mac se usó pnpm 10.23.0 basado en Node para evitar que
  el ejecutable standalone interpretase `--env-file` de Wrangler como suyo.
- [x] E2E de bundles producción 6, privacidad 36 y actualización PWA 8 correctos.
- [x] Sync Capacitor sin cambios generados inesperados; Android Debug compila
  offline e iOS Simulator compila sin firma ni configuración Firebase privada.
- [x] Suite integral `queue-verification --all`: 754 tests API en 63 suites,
  14 tests del harness y 208 E2E en Chromium/Firefox/WebKit; informe PASSED.
- [x] Revisión previa a commit/push/PR completada. El checkout original continúa
  limpio y la rama de destino es exclusivamente `codex/mobile-validation`.
- [ ] Comprobar CI de la PR antes de considerar una futura fusión, que requiere
  autorización separada. No fusionar ni desplegar en este checkpoint.

Logs de esta revisión: `reports/pr-preflight/` (ignorados). Las migraciones
0029–0032 se incluyen como fuentes, **no se aplican a bases remotas**. Push sigue
apagado por defecto. Esta revisión no añade envíos a la prueba física anterior.

## Android físico — Samsung SM-T500 / Android12 — 2026-10-21

Alcance: misma prueba local autorizada que en iPhone, ahora exclusivamente en la
Samsung USB del usuario. No despliegues, cambios remotos ni otros destinatarios.

- [x] USB autorizado; Android12 y WebView154.0.8037.106. APK Debug instalado en
  `com.noqueue.app`, sin desinstalar/borrar datos; TLS local verificado por USB.
- [x] Entorno Android independiente HTTPS8790/control8791; APIiPhone8788 y
  Vite5173 existentes preservados. Datos sintéticos y D1 efímera.
- [x] Inicio, búsqueda «local», formulario de restaurante y alta «Prueba Android»
  desde UI real. Sin teléfono/login/WhatsApp; S6UMKJ en espera.
- [x] Cierre completo/reapertura COLD recupera S6UMKJ sin duplicar alta ni identidad.
- [x] Activar avisos → Desactivar avisos; exactamente1registro Android/FCM.
  No envío automático por registrar; contactos, consentimientos y WhatsApp0.
- [x] Usuario confirma «tablet bloqueada» antes del envío. Coordinador llama al
  turno; FCM accepted/1attempt a17:27:18UTC. Presupuesto agotado antes de egress;
  Android registra1notificación NoQueue en canal queue-updates. Bloqueo observado.
- [x] Usuario confirma apertura desde la notificación; captura «¡Es tu turno!»
  S6UMKJ y API con1resolución autenticada notice200 seguida de lecturas del turno.
- [x] Desactivar avisos desde UI elimina registroFCM. Desarmado explícito,
  cancelación confirmada desde UI (S6UMKJ cancelled v2), feedback y regreso al inicio.
- [x] Build pushOFF recompilado/reinstalado encima; arranqueCOLD vuelve a inicio
  sin recuperar turno cancelado. Registro0; shutdown correcto,8790/8791/9225
  cerrados y túneles retirados, sin directorios privados temporales restantes.
  iPhone8788/5173 continúa sin reinicios.
- [x] Validación dirigida:40testsAPIpush,23webpush,45mobile,3opcionesCLI;
  tiposAPI, buildweb, syncAndroid y assembleDebugON/OFF correctos.
  No se ha repetido toda la suite web/E2E en esta prueba física.

Evidencia privada/ignorada: `reports/android-device/`. No extrapolar esta prueba
al permiso Android13+, Google Play, rotación de token ni recepción con proceso
terminado/force-stopped. La reapertura COLD anterior prueba recuperación del turno,
no recepción push después de force-stop.

## Seguimiento push completo — implementación local 2026-10-21

Este checkpoint se añade al estado previo; **no** certifica un segundo flujo
físico ni extiende la autorización de la prueba anterior de una llamada.

- [x] Migración0033 elimina trigger antiguo y conserva IDs/historial legacy sin replay;
  nuevas intenciones transaccionales con clave por evento y snapshot versionado.
- [x] Referencia push independiente de WhatsApp, con origen pantalla/sync/FCM;
  alta, paso, edición y abandono propios sin duplicar confirmaciones.
- [x] Catálogo ES/EN, acercamiento, retrasos/prórrogas ordenadas, mejoras,
  llamada normal/anticipada, expiración, cancelación externa/neutral y cierre.
- [x] Despacho comprueba vigencia/ciclo, TTL, revocación y tenant; navegación
  propietaria y payload público conservados, foreground sin cambios.
- [x] Migración y pruebas en bases efímeras, proveedores simulados y red fail-closed.
- [x] Regresión final API822/822 en66suites, incluyendo migración, equivalencia,
  tres prórrogas, cesión al sucesor, edición propia y respuestas tardías.
- [x] Web764/764 con concurrencia acotada (`--maxWorkers=2`), contratos89/89,
  toolingmobile47/47 y toolingAPI14/14. Dos corridas web con concurrencia por defecto
  tuvieron fallos de timing diferentes en tests previos (`RouteErrorBoundary` y
  `NativeDiscovery`); no se modificaron esos archivos ni sus expectativas.
- [x] Tipos API/web/mobile, buildweb con pushOFF, API dry-run,
  AndroidDebug offline e iOSSimulator Debug sin firma correctos. No instalación,
  sincronización nativa, arranque de dispositivo ni envíos reales en esta fase.
- [x] Harness físico separado con presupuestos por escenario y un solo destinatario;
  guard probado con mocks, **runner real no ejecutado**.
- [ ] Ejecutar acta física de ciclo completo en iPhone y Android con autorización
  específica: variantes, permisos, primer/segundo plano/bloqueo, proceso terminado,
  apertura antigua y recuperación de red. Android12 y13+ independientes.
- [ ] Posposición staff efectiva: hoy `skip` es unsupported_action; no se ha añadido
  una acción de negocio nueva. Si se habilita, añadir su prueba de integración.
- [ ] Distribución TestFlight/APNs producción y Android de prueba, runtime desplegado
  y red externa: fase separada con autorización propia.

Matriz, límites y recetas en `docs/runbooks/mobile-push.md`, sección «Seguimiento
completo». No commits, migraciones remotas ni cambios de gates. No se ha repetido
la suite E2E integral de208casos de checkpoints anteriores en esta implementación.

## Android físico — seguimiento completo local — 2026-10-21

Autorización posterior solo dispositivo propio Samsung SM-T500 Android12/API31,
envíos acotados y restauración. Acta detallada y límites en
`docs/runbooks/mobile-push.md`, «Ejecución física Android de ciclo completo».

- [x] Normal: acercamiento → llamada normal → llegada; aviso antiguo abre estado
  expirado tras desbloqueo. Recepción bloqueada observada en primera ejecución.
- [x] Cuatro acercamientos y tres prórrogas diferentes recibidos/abiertos en orden.
- [x] Recepción visible de llamada final tras prórrogas acreditada en nueva
  ejecución autorizada22oct (ver apartado siguiente). El21oct solo se acreditó
  aceptaciónFCM; se mantiene esa limitación histórica, sin reenvío automático.
- [x] Mejora neutral foreground con callback real sin notificación de sistema;
  mejora recomendada y llamada anticipada recibidas/abiertas.
- [x] Apertura desde proceso terminado por `am kill`, PID ausente y stopped=false;
  no confundir con force-stop ni prometer entrega bajo esa restricción del SO.
- [x] Paso esperando, paso llamado sin sucesor y con sucesor; nueva llamada.
  Confirmaciones propias y abandono sin push duplicado. Dos ejecuciones separadas
  para no confundir el reordenamiento del acompañante con un sucesor posterior.
- [x] Expiración real, cancelación staff y cierre específico sin duplicado genérico.
- [x] Apertura sin túnel de API y recuperación del mismo aviso al restablecerlo.
  No acredita desconexión de internet/FCM ni funcionamiento remoto.
- [x] Android12: revocar en Ajustes → CTA Activar → ajustes reales → recuperar ON.
- [x] 24 intentos reales dentro del máximo27; un único receptor por ejecución,
  sin topics ni destinatarios adicionales, cero WhatsApp en la evidencia.
- [x] Restauración: APK SHA256,53 archivos privados y124 assets idénticos;
  vault preservado, permiso ON, inicio original y launcher; mismo proceso8790 y
  reverse8790, recursos8792/8793/9226 retirados, configuración temporal eliminada.
- [x] Tooling API15/15 y diff-check OK. Sin producción, commits ni despliegues.
- [ ] Android13+ (diálogo runtime), iPhone/ciclo completo y fase de distribución
  remota siguen pendientes de dispositivos/autorizaciones correspondientes.

Evidencia y backups privados ignorados por Git:
`reports/android-device/push-lifecycle-session/`. No publicar datos privados.
La aceptación FCM se registra separada de recepción y resolución autenticada;
no se certifica entrega garantizada ni exactamente una recepción.

## Android — cierre de llamada tras prórrogas — 2026-10-22

- [x] Nueva autorización acotada, misma tablet SM-T500 Android12;8/8intentos dentro
  del máximo8 de esta ejecución, sin reenvíos ni otros escenarios.
- [x] Cuatro acercamientos y tres prórrogas aceptados, recibidos/abiertos, seguidos
  de llamada final real; ID correlacionado entre outbox, FCM, registro Android,
  panel y resolución autenticada del turno correcto.
- [x] Antes de llamar: launcher activo y Capacitor `isActive=false`. Después:
  llamada visible, apertura correcta y llegada confirmada. Cero callbacks foreground.
- [x] Restauración contra snapshot del22oct: APK y54archivos privados idénticos,
  vault y permisoON conservados, launcher; entorno8792/8793/9226 retirado y
  reverse8790 previo intacto. App original arranca con aviso de datos no
  disponibles porque su API8790 ya estaba apagada y no se reactivó. Assets y
  código del producto sin cambios.
- [x] La comprobación pendiente del21oct queda resuelta; no se atribuye una causa
  al resultado observacional anterior sin evidencia ni se generaliza a otros SO.

Acta detallada en `docs/runbooks/mobile-push.md`; evidencia privada ignorada por
Git en `reports/android-device/push-final-call-20261022/`. Android13+, iPhone y
entorno remoto siguen pendientes.

## iOS — llamada física acotada — 2026-10-22

- [x] iPhone14ProMax/iOS27.0.1: única llamada real autorizada, aceptación FCM y
  notificación visible con pantalla bloqueada acreditadas por separado.
- [x] Apertura real autenticada del aviso al turno correcto; al haber vencido el
  plazo, muestra el estado actual `expired`, no la llamada antigua.
- [x] Sin segundo envío ni aviso de expiración; cero WhatsApp, solo iPhone propio.
- [x] App original, vault y708archivos del contenedor restaurados y verificados;
  servicios temporales cerrados, sin modificar producción ni Android.
- [x] Confirmación de llegada comprobada en ejecución posterior del22oct, con
  un único aviso: apertura real por el usuario y acción real `complete` del
  personal; el iPhone muestra «Se ha confirmado tu llegada». No existe botón
  de llegada del cliente en este escenario de restaurante. Plazo10min solo en
  la fixture local; aplicación, identidad y708archivos restaurados/verificados.
- [ ] Resto del ciclo físico completo iOS y distribución remota/TestFlight.

No atribuir esta validación parcial al conjunto del plan. Acta y límites en
`docs/runbooks/mobile-push.md`, «iOS — llamada única y apertura de aviso antiguo».

## 25/10/2026 — Smoke físico de staging y preparación de distribución interna

Esta entrada añade el resultado físico reciente sin reescribir los cierres locales
ni las pruebas parciales de octubre. El acta completa es privada/ignorada por Git:
`reports/staging-private/mobile-2026-10-25/verification.json`.

- [x] Smoke de staging en iPhone14ProMax y Samsung SM-T500: discovery/búsqueda y
  alta nativa en ambos; push llamado recibido y apertura del turno correcto en
  ambos; recuperación/llegada en iOS y expiración en Android.
- [x] 2 instalaciones registradas (1 Android/1 iOS); 11 intentos de outbox
  aceptados a primer intento, sin errores/pending/failed; 88/88 tests push y
  typecheck API pasaron. La aceptación del proveedor no prueba visualización de
  todos los avisos del ciclo.
- [x] Se conservaron los registros QA; el build iOS normal final se reinstaló y
  arrancó sin XCTest. Sin borrado de datos, WhatsApp o cambios en producción.
- [ ] No declarar regresión completa: QR/cámara, geolocalización y offline no se
  probaron en esa sesión; tampoco se validaron todos los permisos revocados ni
  firma/distribución de stores.
- [ ] Integrar y auditar los nuevos masters de marca y generar builds Release de
  distribución con endpoint staging explícito. **iOS/Android siguen PENDIENTES**
  hasta tener hashes, firma y validación del binario final; los builds Debug del
  smoke no son artefactos para tiendas.
- [ ] Obtener inputs externos de firma: perfil/certificado Apple Distribution
  y acceso organizacional; Android upload key/keystore y custodia/Play App Signing.
  La sesión física solo validó Apple Development; la clave de subida Android no
  está identificada. No poner claves en Git.
- [ ] Capturar un pack nuevo de ficha con datos sintéticos después de integrar la
  marca. Los screenshots nativos existentes son de simulador/emulador y apuntan
  a pruebas locales; falta iPad mientras siga habilitado en Xcode.
- [ ] Revisar push, cámara QR y ubicación opt-in/rechazada/revocada en los builds
  finales, más textos de propósito y privacidad. Búsqueda manual debe seguir
  disponible si cámara o ubicación se deniegan.
- [ ] Internal Testing/TestFlight y Google Play no se han iniciado ni subido.
  Cualquier carga requerirá autorización independiente.

Detalle del pipeline, inputs de firma, inventario de capturas y gates:
`docs/runbooks/mobile-release.md`.

### Resultado de implementación branding/release — 25/10/2026

- [x] Masters Figma aprobados, 48 recursos nativos/Store deterministas, sin recolor de interfaz/PWA; icono con degradado y splash estático.
- [x] Textos de permisos ES/EN, red local solo Debug, eliminación de boot restore local sin quitar FCM.
- [x] Perfil `internal-staging`, hash del payload verificado en ambas plataformas; scripts prepare/verify y pruebas de regresión.
- [x] AAB1.0(1003) firmado con nueva upload key autorizada fuera de Git; bundletool/firma/manifest/payload auditados.
- [x] Archive Release y IPA1.0(1003) App Store Connect exportado; firma Apple Distribution y APNs production auditados. Export local, no upload.
- [ ] Registrar/contrastar upload certificate con Play Console; verificador conserva storeReady=false, auditValid=true.
- [ ] Validación visual cold/warm, matriz física de permisos y nuevas capturas iPhone/iPad/Android. No realizadas en esta ejecución.
- [ ] Subidas, procesamiento, instalación desde Stores y entrega real TestFlight/APNs production: intervención futura.

Artefactos y hashes: `output/mobile/internal-staging-1003/`. Detalle y límites en `docs/runbooks/mobile-release.md`; la evidencia anterior no se atribuye a este nuevo build.

### QA visual/permisos y revisión1004 — 25/10/2026

Esta entrada actualiza, sin borrar, los pendientes históricos anteriores.

**Implementado**
- [x] Corregido clipping splash Android12 y foreground adaptativo navy; máscaras seguras probadas por píxel.
- [x] 48 derivados deterministas; AAB/IPA1004 firmados y auditados. AAB1003 supersedido.

**Verificado localmente**
- [x] QR real Android/iPhone confirmado por usuario; cámara y ubicación contextual, rechazo y recuperación.
- [x] Push revocado/recuperado desde Ajustes en ambos físicos; FCM Android real con icono nuevo/canal queue-updates y apertura desde background.
- [x] Splash frío y retorno caliente Android desde launcher Samsung sin clipping; sin demora artificial.
- [x] 12 capturas reales de UI: iPhone físico, tablet Android física e iPad **simulado**, con manifest y hashes.
- [x] 69 tests mobile +73 web focalizados; tipos y generación verificadas.
- [x] Turnos propios cancelados; QA1011Piscina pausada/sin inscripciones y sin turnos. Chat continúa abierto por petición del usuario.

**Pendiente local/dispositivos**
- [ ] Splash iPhone concluyente desde launcher y matriz visual completa de apariencias; iPad físico y Android13+ físico.
- [ ] Primera solicitud push iPhone desde permiso no determinado; lo probado fue revocación/recuperación sin borrar datos.
- [ ] Confirmación upload certificate en Play Console y estado de cuentas; auditValid=true **no** equivale a storeReady=true.

**Pendiente tras distribución autorizada**
- [ ] Upload/procesamiento/instalación Store, actualización entre versiones, TestFlight/APNs production y notificación desde proceso terminado.

Acta: `docs/development/mobile-brand-qa-2026-10-25.md`.
Capturas: `output/mobile/store-screenshots-2026-10-25/`.
Binarios: `output/mobile/internal-staging-1004/`. No se ha subido nada.


### Refinamientos 25/10 — estado más reciente, build1006

**Implementado**
- [x] Spinners inline-start y aria-busy en botones ocupados/sheets.
- [x] Regresos al buscador; ruta /v deprecada con redirect; back Android sin historial.
- [x] SplashScreen oficial8.0.2 manual hasta ruta/error listo, sin retardo mínimo.
- [x] Visor QR object-cover sin audio ni nuevo plugin/permisos.
- [x] AAB/IPA1006 firmados y auditados; configuración splash dentro del binario verificada.

**Verificado localmente**
- [x] 415 tests web focalizados +69 mobile; tipos y diff-check.
- [x] Splash y regreso al inicio Android/iPhone físicos1005; iPad simulado1005.
- [x] Back desde enlace sin historial Android físico1006; ambos físicos actualizados a Debug1006.
- [x] Fuente/IPA AppIcon iOS correctos; sin segunda NoQueue instalada. Icono Android real probado1004.
- [x] QA1011Piscina restaurada a pausada/0 turnos; sin producción, WhatsApp ni upload.

**Pendiente local**
- [x] Encuadre cámara física Android/iPhone1006 sobre superficie neutra: marco completo sin bandas; Volver cierra cámara y vuelve a discovery.
- [x] Busy físico1006: Pasar turno y Abandonar Android; Abandonar iPhone. Vídeos muestran spinner animado a izquierda de Guardando… y controles deshabilitados. No equivale a captura individual de todos los sheets staff/party/space.
- [x] Nueva push recibida en iPhone físico1006 (XCTest 1/1); captura limitada a su banner.
- [x] **Revalidado tras reinicio:** una nueva push1006 (turno ZXM6LR) muestra NoQueue, no Capacitor. Sin cambiar assets, reinstalar ni borrar datos. Evidencia física del caso resuelto; no garantiza todas las apariencias/dispositivos ni TestFlight.
- [ ] Android13+/iPad físicos, apariencias y regresión específica de tecleo rápido.
- [ ] Asociación upload certificate/Play y estado de cuentas. AuditValid=true no basta para StoreReady.

**Pendiente tras distribución**
- [ ] Upload e instalación/update de Store; APNs production/TestFlight y proceso terminado.

Binarios vigentes: `output/mobile/internal-staging-1006/`;1004/1005 supersedidos.
Acta ampliada: `docs/development/mobile-brand-qa-2026-10-25.md`. Chat permanece abierto.


### Inicio distribución interna autorizada — 25/10/2026

- Usuario autoriza subir build1006 de staging a Play Internal Testing y TestFlight
  interno e invitar **solo sosa.johan@gmail.com**. No producción ni pruebas públicas.
- [x] Sesiones Chrome verificadas: Play NQ-APP (6460888057339474774) y Apple
  LUMOSA S.A. (6VYYNUZPSH, coincide con el perfil firmado).
- [ ] Play: primera app aún no creada; formulario bloquea aceptación de Play App
  Signing porque el usuario actual carece de permiso. Solicitada actuación de
  propietario/administrador, sin intentar eludir permisos.
- [ ] Apple: Account Holder debe aceptar el Apple Developer Program License
  Agreement actualizado. Solicitado al usuario; no aceptado en su nombre.
- [ ] Apple: confirmar Company Name de la primera app (propuesto LUMOSA S.A.),
  nombre público de desarrollador no editable normalmente después de crearla.
- [ ] Crear registros, subir AAB/IPA, esperar procesamiento, configurar grupo/lista
  restringido al único email autorizado y enviar invitación/enlace de adhesión.
- **No se ha subido ningún binario ni enviado invitaciones.** No se han creado
  registros, sustituido claves ni cambiado permisos. Bloqueos de cuentas en
  `reports/mobile-store-distribution/2026-10-25/` (privado, fuera de Git).


### Actualización Apple y pausa por aclaración de TestFlight — 25/10/2026

- Acuerdo Apple aprobado por titular, ausencia de aviso comprobada. Company Name
  LUMOSA S.A. confirmado usuario. Registro No Queue creado: App ID6826825713,
  bundle/SKUcom.noqueue-app.ios, idioma españolEspaña, acceso limitado.
- Subida desde archive1006 finalizó `EXPORT SUCCEEDED`, `Upload succeeded`, a las
  12:35, con `testFlightInternalTestingOnly=true` y sin incremento automático de
  build. No publicación App Store. Procesamiento final no comprobado todavía.
- Grupo `Internal Staging — Johan`, distribución automática desactivada, solo
  sosa.johan@gmail.com añadido; UI 1 tester /0 builds/No Builds Available.
  No afirmar entrega de invitación ni disponibilidad para instalar.
- Usuario interrumpe para aclarar External Testing: correcto para personas sin
  usuario App Store Connect. Operaciones detenidas; build Internal Only no sirve
  para externos. Hará falta un nuevo build elegible (número1007 o siguiente libre),
  grupo externo por email sin enlace público y TestFlight App Review.
- Play sigue sin upload, bloqueado por aceptación PlaySigning del propietario.
  Guía GoogleDoc leída: contratoscliente, noAdmin/produccióndelegado por defecto.
  Pendiente entregar pasos no técnicos para Alberto: crearborradorNoQueue desde
  cuentaowner/aceptarterminos, sinpublicar; evitarampliar permisos.


### TestFlight externo privado — build1007, 25/10/2026

- [x] Usuario confirma **iOS externo por email**, únicamente
  `sosa.johan@gmail.com`; Android mantiene Internal Testing, pendiente de Alberto.
- [x] Build1.0(1007) preparado con `internal-staging` (nombre del perfil de backend,
  no del canal de testers). Assets web idénticos a1006, mismo SHA-256; solo número
  de build y elegibilidad de distribución nuevos. Sin despliegue web/backend.
- [x] ArchiveRelease genérico y IPAAppStoreConnect exportados con
  `testFlightInternalTestingOnly=false`. Auditoría del IPA: todas las comprobaciones
  pasan, AppleDistribution/team6VYYNUZPSH/APNsproduction/perfilAppStore; no live
  reload/XCTest/Analytics. El resultado global del verificador queda false solo
  porque no se pasó AAB; el artefacto iOS es `storeReady=true`.
- [x] Upload1007 terminado `EXPORT SUCCEEDED`. ASC muestra Binary State Validated,
  versión1.0/build1007, iPhone+iPad y entitlements APNsproduction.
- [x] Grupo `External Staging — Invitación privada` creado
  (65cdd1bd-1e4a-46dc-bee2-3ba2f9b9593b), solo emailJohan, sin publiclink.
  Grupo interno anterior queda sin builds y sin distribución automática.
- [x] Datos de contacto autorizados y notas de revisión guardados en ASC; flujo
  cliente no requiere login. Referencia a política de privacidad existente de staging.
- [x] QA1011Piscina reanudada con autorización para durar la revisión. Horario
  temporal24hL-D; original24hsoloLunesyDomingo. Capacidad2/intervalo2min intactos.
  Restaurar horario original y pausar lista cuando termine; no cancelar turnos ajenos.
- [x] Declaración de cifrado1007 guardada tras autorización explícita del usuario:
  None of the algorithms mentioned above por uso de HTTPS/KeychainOS.
- [x] 1007 asociado al grupo externo y enviado a BetaAppReview. Estado confirmado
  **Waiting for Review**,1tester/1build. Notificación automática activada para el
  único tester. Hasta aprobación no afirmar invitación instalable, email entregado
  ni disponibilidad TestFlight.
- [ ] Apple debe aprobar la beta; después verificar invitación y restaurar horario
  original de QA1011Piscina y pausar la lista según autorización.
- [ ] Instalar desde TestFlight y validar APNsproduction/update/proceso terminado.

Artefactos y provenance: `output/mobile/external-staging-1007/`.
Evidencias/estado privado: `reports/mobile-store-distribution/2026-10-25/`.
AAB1006 intacto, sin uploadPlay. Guía clientePaso7.1 ya actualizada para Alberto.
No publicación AppStore ni enlace público ni nuevos testers. Chat permanece abierto.

### Android: nuevo identificador y prueba interna — build1008, 25/10/2026

- [x] Adoptado `com.noqueueapp.android`, confirmado por usuario y creado por Alberto
  en Play. No contiene razón social; iOS conserva `com.noqueue-app.ios`.
- [x] Migrados `applicationId`, namespace, Java, Capacitor, recursos y runners
  Android. Preparación `--platform android` evita sincronizar o modificar iOS.
- [x] Registrada nueva app Firebase en `nq-app-f3127`:
  `1:54689871019:android:862772299ec67a4cbf73ee`. SDK config descargada desde
  Firebase; no editar únicamente el package de la configuración antigua.
  Mismo sender `54689871019`, FCM v1 activo; no requiere rotar credenciales backend.
  Apps Firebase anteriores e iOS/APNs preservadas.
- [x] AAB firmado 1.0(1008), perfil `internal-staging`, targetSDK36, push activo,
  Analytics desactivado. Payload web idéntico a1006/1007. 71 tests mobile,
  16 tests FCM, typecheck y `bundletool validate` pasan.
- [x] AAB aceptado y publicado exclusivamente en **Prueba interna**. Play confirma
  **Activo / Disponible para testers internos**, 25oct14:09; versión
  `1.0 (1008) — staging interno`, sin revisión. No producción ni prueba abierta.
- [x] Lista `NoQueue — Pruebas internas Johan`, un único correo
  `sosa.johan@gmail.com`, seleccionada y guardada. Enlace habilitado:
  <https://play.google.com/apps/internaltest/4701544486585037113>.
- [x] Certificado **de subida** leído desde Play, SHA-256
  `BB:A1:D5:00:F2:DD:D0:C5:1C:8E:42:F1:5F:8A:E8:2A:32:79:87:EF:25:DC:53:78:6B:40:9D:28:37:17:45:6E`.
  Coincide con el firmante del AAB: 10/10 comprobaciones, artefacto Android
  `auditValid=true, storeReady=true`. Global `storeReady=false` solo porque
  no se proporcionó un artefacto iOS en esta auditoría Android-only.
- [x] Hashes de102 archivos iOS/wrangler idénticos al inicio de esta migración;
  no despliegue web/backend ni envío de notificaciones ni cambios de permisos.
- [x] Opt-in del único tester completado e instalación real desde Google Play en
  Samsung SM-T500/Android12: package nuevo, versión1008,
  `installerPackageName=com.android.vending`. Firma del APK instalado coincide
  con Play App Signing (SHA-256 `C2:A0:92:F3:CE:AF:7B:63:58:C3:6A:FE:4F:4E:37:C3:6D:06:5B:E1:D9:D0:AB:A9:DE:DB:EE:44:9D:B0:15:8B`).
  Instalación antigua `com.noqueue.app` y sus datos conservados.
- [ ] Flujos completos de turno/permisos y entrega FCM real (incluido segundo
  plano/proceso terminado): pendientes, no declarar PASS. Bloqueo histórico
  de conectividad resuelto con la VPN de la tablet, ver verificación inferior. Primer arranque
  muestra «No se pueden actualizar los datos» con Reintentar. Mac/Chrome y HTTPS
  independiente reproducen timeout hacia staging, antes de obtener respuesta
  API; ambas IPs DNS `188.114.96.5`/`188.114.97.5` fallan. Causa última de red
  desconocida, no atribuida al package/Firebase. API de gestión Cloudflare y D1
  sí responden: Worker staging `e3c205d1-0415-4d89-8cc5-b8ca70f5941e` intacto,
  38 migraciones y 2 registros push preexistentes; consultas solo lectura.
  No nuevos envíos, cambios DNS/seguridad, despliegues ni build especulativo.
  Repetir validación cuando staging vuelva a ser accesible.

Play puede mostrar temporalmente `com.noqueueapp.android (unreviewed)` hasta
completar configuración/revisión. Puede tardar en propagarse la disponibilidad.
Nuevo package significa instalación separada de `com.noqueue.app`: no borrar
la instalación antigua ni asumir migración de datos/turnos.

Dos advertencias no bloqueantes: falta archivo de desofuscación (esta build usa
`minifyEnabled=false`) y símbolos de depuración nativos. No impidieron publicación.
Cuenta6460888057339474774, app4972895022306821942, canal4701544486585037113,
release1. Artefacto/auditoría: `output/mobile/internal-staging-1008/`.
Evidencias y backups privados:
`reports/mobile-store-distribution/2026-10-25/android-migration/`.
AAB SHA-256: `82ccb2d58d0c5ac800b05d665af1b436fffebfbae7aed2f3856e64f37470b785`.

### Recuperación desde VPN de la tablet — 25/10/2026 16:47 UTC

- [x] Usuario instaló VPN en la Samsung SM-T500. Diagnóstico TCP443 a staging
  desde el propio Android retorna exit0; no se cambió la red desde el agente.
- [x] Verificada de nuevo la instalación `com.noqueueapp.android` 1.0(1008),
  installer `com.android.vending` y foreground del paquete nuevo.
- [x] Inicio sin error y catálogo real de staging visible: QA1011Piscina,
  Sol Lunamar Palmanova — Front Desk y QA1011Recepción. La consulta visible
  `1` filtra a los dos servicios QA1011. Evidencias privadas:
  `android-tablet-vpn-catalog.png` y `android-tablet-vpn-search.png`.
- [ ] Flujo completo del turno, permisos y entrega FCM real siguen pendientes.
  Esta comprobación solo acredita apertura/lectura/búsqueda; no se creó turno
  ni se envió aviso. No fue necesario recompilar ni cambiar Firebase.


### Prueba dirigida Play1008 y detención por límite de avisos — 25/10/2026 16:58 UTC

- [x] Alta nativa del único turno sintético `QA Play1008`/`YJT4WU` en
  QA1011Piscina y consulta desde la nueva app de Google Play. D1 de solo lectura
  confirma vínculo propietario nativo único y registro Android/FCM habilitado;
  cero contactos WhatsApp. No se leyeron tokens ni secretos.
- [x] Abandono desde la app y cancelación confirmados; lista queda con 0 turnos.
  No se modificaron turnos ajenos ni la app antigua.
- [!] **Desviación del presupuesto de prueba:** el registro tras el alta y los
  temporizadores del ciclo generaron automáticamente 3 avisos (`approaching`,
  `delayed`, `approaching`), aceptados por FCM a primer intento para una única
  instalación. El límite autorizado era 1. No se ejecutó llamada manual ni
  envío de prueba adicional; se detuvo y canceló el turno propio al detectarlo.
  El modo manual de la cola no impide estos avisos de ciclo. El plan de prueba
  no imponía un límite de salida en el staging desplegado.
- [ ] Recepción visual, apertura, segundo plano/proceso terminado y matriz de
  permisos **no validados**. Aceptación del proveedor no equivale a entrega.
  Seguimiento pausado; presupuesto restante 0 turnos/0 avisos. Antes de más
  pruebas reales hace falta autorización revisada y un plan con límite de
  envío efectivo, sin cambios globales que afecten a otros dispositivos.

Evidencias: `android-play1008-own-turn-cancelled.png`,
`staging-own-turn-cleanup.png` y detalles de outbox sin secretos en `status.json`.
Espejo cerrado, tablet en Inicio y VPNs intactas.

### Reanudación autorizada y resultado parcial — 25/10/2026 17:40 UTC

Esta sección actualiza el estado actual sin reemplazar el incidente histórico.
El usuario reanudó la QA; el heartbeat previamente eliminado sigue eliminado.

- [x] Permisos de cámara y ubicación: denegación con fallback y recuperación
  «Solo esta vez» verificadas físicamente. Visor real de cámara y catálogo
  cercano visibles. Permisos temporales expirados al terminar.
- [x] Turno propio `QA Android BG1008`/`W44WMN` en nuevo servicio exclusivo
  `QA Android1008 aislado`: alta → llamado → llegada confirmada → completed.
- [x] Una notificación real `called` recibida visualmente en segundo plano.
  Un destinatario Android habilitado, mismo propietario nativo verificado,
  cero contactos WhatsApp. Un turno y un aviso nuevos dentro del plan2/2.
- [x] Limpieza: servicio aislado pausado, cero turnos activos propios, cero
  avisos propios pendientes, espejo cerrado y tablet en Inicio. VPNs intactas.
  Los 102 hashes protegidos conservados.
- [x] Pruebas locales: mobile71, API push69 y web933, todas PASS; types web PASS.
  Corregida alerta duplicada de asignación obsoleta en Dashboard, con regresión.
  **Corrección solo local, no desplegada ni incorporada a Play1008.**
- [ ] Apertura pulsando notificación: control remoto SystemUI no fiable.
- [ ] Recepción/apertura con proceso cerrado y permisos de notificaciones.
- [ ] Decodificación QR físico; permiso y visor no equivalen a lectura QR.
- [ ] Incorporación controlada de corrección local y regresión desplegada.

Resultado: **parcial, no certificable como todas las pruebas superadas**.
Informe y evidencia de cierre en
`reports/mobile-store-distribution/2026-10-25/android-migration/validation-report.md`
y `cleanup-verification.json`. La captura de notificaciones es privada porque
incluye avisos ajenos; no publicarla sin ocultarlos.
