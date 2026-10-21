# Push móvil — implementación local, apagada por defecto

Bloque1 validado en local; push es un canal nuevo, no una repetición de las pruebas
web. Este documento **no autoriza despliegues ni envíos reales**. La creación de
credenciales limitadas fue autorizada expresamente el20/10/2026; estado abajo.

**Última implementación: 21/10/2026 — FCM también para iOS, solo local.**
Ruta elegida: Worker → FCM HTTPv1 → APNs → iOS. Evita depender de HTTP/2 directo
Workers→APNs o mantener un relay. SDK oficial integrado, app iOS registrada, configuración cliente instalada y
claves APNs de ambos entornos cargadas con confirmación explícita. Firma Development
y pruebas físicas sin avisos ya completadas. Entrega y apertura reales en Development
validadas el21/10; la prueba local autorizada se documenta al final. Quedan
TestFlight/APNs producción y runtime desplegado. Los gates fuente siguen OFF. Los registros anteriores se conservan como
histórico; sus referencias a APNs directo no describen la ruta activa actual.

## Qué está implementado

- `0030_mobile_push.sql`: registro por instalación y outbox separados de WhatsApp.
  Trigger atómico sobre transición `called`/`expired`/`cancelled`, solo para turnos
  asociados a instalación y con registro habilitado. No crea contactos ni consents.
- API móvil, detrás de la misma identidad/CORS/cuotas del bloque1:
  - `GET /api/v1/mobile/push/registration`: disponibilidad por plataforma y estado,
    sin devolver tokens.
  - `POST .../registration`: iOS `{platform:"ios", provider:"fcm", token, locale}`;
    Android conserva `{platform:"android", token, locale}` (provider fcm opcional);
    upsert propietario, token cifrado con clave exclusiva, HMAC único.
  - `POST .../revoke`: elimina token y descarta pendientes; idempotente.
  - `GET .../notices/:id`: resuelve capability solo con instalación propietaria y
    tenant activo, incluso si terminó el turno. El ID de aviso **no** autoriza.
- App: listeners antes de registro, permiso solo desde CTA de turno, registro
  renovado en resume si ya se activó, revocación, errores recuperables y timeout.
  Negar permisos nunca cambia identidad ni bloquea alta/consulta.
- Apertura: payload solo `{type:"queue-update", notificationId}`; la app resuelve
  por API y consulta el turno. Ignora URLs arbitrarias. Un ID ajeno/borrado va al
  inicio sin revelar turno. Con fallo de red conserva hint en memoria para resume.
- FCM HTTPv1 para iOS y Android, OAuth RS256; claves solo servidor, endpoints
  fijos, redirects manuales no seguidos y timeout10s por petición. El payload iOS
  lleva configuración APNs alert/topic/expiration/collapse; no campos Android.
- iOS requiere token **FCM**, no el token APNs del plugin Capacitor. Puente propio
  `packages/native-fcm`, SDK FirebaseMessaging 12.7.0 fijado con SPM. APNs se enlaza
  manualmente antes de obtener FCM; renovación, deduplicación y callbacks tardíos
  controlados. Capacitor sigue siendo dueño de permisos/recepción/apertura.
- Firebase no se inicializa al cargar el plugin: exige gate nativo, configuración
  cliente válida y permiso del SO. Auto-init siempre OFF, swizzling OFF, sin
  productos Analytics/Auth. No modifica NoQueueVault ni la identidad anónima.
- `0032_mobile_fcm_ios.sql` separa plataforma de proveedor, conserva Android y
  retira solo registros APNs antiguos y sus avisos pendientes. No convierte APNs
  en FCM ni borra identidades, turnos o avisos aceptados. Clientes iOS anteriores
  no podrán registrar APNs: planificar actualización antes de futura activación.
  El serializador APNs directo y su gate quedan legacy, sin uso desde rutas o
  dispatcher; no es fallback automático.

## Procesamiento, límites y privacidad

Cada cambio y fila outbox se confirman juntos. El coordinador programa un flush
sin bloquear su propia cola de serialización; envío y comprobación de estado se
serializan en el coordinador propietario. El cron existente recupera hasta25
avisos pendientes por pasada, sin usar la queue WhatsApp ni crear infraestructura.
Una llamada espera como máximo su arrival deadline; avisos terminales TTL10min.
Lease60s, máximo5 intentos, backoff60s exponencial y `Retry-After` respetado.
Se descarta si cambia versión/estado, vence TTL o se revoca/suspende destinatario.
El token más reciente de la instalación es el destino; respuesta de token inválido
se aplica solo al hash enviado, evitando borrar una rotación concurrente.

Aceptación APNs/FCM no demuestra entrega/lectura. La pérdida de una respuesta tras
aceptación puede producir reenvío: no se promete exactly-once. Se conserva el ID
lógico y collapse/tag por aviso. Una revocación no puede retirar una petición ya
en vuelo ni una alerta ya entregada por el SO. Al abrir siempre manda el estado
actual de API, no el contenido histórico de la alerta.

Tokens inactivos90d se descartan al enviar y se purgan en lotes100; outbox/hints
se purgan a30d, también en lotes100. Registro se refresca al volver a la app. Esto
no elimina identidad ni turno. No se guarda token en localStorage, payload visible,
checkpoints ni logs. No añadir analytics ni medir lectura humana por aceptación.

## Configuración y activación futura (consultar estado registrado abajo)

1. IDs registrados: Android `com.noqueue.app`; iOS `com.noqueue-app.ios`. Team Apple `6VYYNUZPSH`.
2. App Firebase iOS **registrada** en `nq-app-f3127`: ID
   `1:54689871019:ios:bf4f2ec894b1aa99bf73ee`, team `6VYYNUZPSH`.
   `GoogleService-Info.plist` descargado, validado e instalado en
   `apps/mobile/ios/App/App/` (0600, ignorado por Git). Es configuración cliente, nunca
   sustituirla por JSON de cuenta de servicio. El build lo copia solo si existe,
   valida proyecto/bundle/sender y elimina copias obsoletas si falta. El puente
   valida también Firebase App ID/API key y bloquea configuraciones incorrectas.
3. **Completado con confirmación explícita:** claves APNs `33FG9322FT` desarrollo
   y `W666TVNM38` producción cargadas en los respectivos apartados Firebase Cloud
   Messaging. No están en el Worker ni en la app. Conservan las restricciones de
   topic/entorno originales; guardar no demuestra autenticación/entrega ante Apple.
   AppDelegate conserva callbacks, entitlement solo `iphoneos`, Debug development,
   Release production. Perfil Development y artefacto físico firmado auditados el21/10;
   firma de distribución/TestFlight y entrega real se validan por separado.
4. Android conserva proyecto y `google-services.json`, canal `queue-updates` y
   contrato actuales. No usa este puente iOS.
5. Aplicar migraciones hasta0032 **solo al entorno autorizado** después de revisar
   compatibilidad y retirada de registros APNs. Aquí únicamente fixtures efímeros.
6. Secretos servidor por entorno: `MOBILE_PUSH_TOKEN_KEY`32bytes hex,
   `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY`. Cuenta dedicada con solo
   `cloudmessaging.messages.create`. No copiar credenciales reales a harnesses ni
   exponer secretos en `VITE_*`. Variables `APNS_*` son legacy, no requeridas por
   esta ruta; `APNS_TRANSPORT_VERIFIED` no habilita FCM iOS.
7. Solo tras autorización: backend `MOBILE_PUSH_ENABLED=true`, iOS además
   `FCM_IOS_ENABLED=true` y `FCM_IOS_BUNDLE_ID=com.noqueue-app.ios`; build frontend
   `VITE_MOBILE_PUSH_ENABLED=true` y plugin nativo `NoQueueFcm.enabled=true` seguido
   de sync/build. **Todos los interruptores siguen false en esta intervención.**
   Disponibilidad backend y nativa se comprueba antes de solicitar permiso.
8. Validar entrega/background/cold start/rotación en staging autorizado y
   dispositivo físico. Mocks, firma local y build no sustituyen este paso.
   Revisar política de privacidad/declaraciones stores por Firebase Installations
   (identificador técnico de FCM, no cuenta ni identidad de acceso de NoQueue).

### Límites que deben resolverse antes de activar

- La ruta vigente ya no exige un cliente HTTP/2 en Workers: FCM gestiona APNs.
  Sigue pendiente validar FCM desde el runtime destino, autorización APNs de
  Firebase, firma y entrega física. No confundir mocks con esa evidencia.
  `node:http2` en Workers sigue sin ser un fallback funcional; la comprobación
  anterior se conserva en tests/histórico, no es un pendiente de esta ruta FCM.
- En Android 12 y anteriores, `checkPermissions()` del plugin devuelve concedido
  aunque el usuario bloquee la presentación de notificaciones en ajustes. El
  registro habilitado no demuestra permiso visual ni entrega. Queda pendiente una
  comprobación nativa adicional si se soportan esas versiones, más prueba física.

## Pruebas locales sin envío real

```bash
WRANGLER_LOG_PATH=/tmp/noqueue-wrangler-logs pnpm --filter @noqueue/api exec vitest run src/features/mobile
pnpm --filter @noqueue/web test push-registration CustomerTurn MobileAdmission RestaurantForm
pnpm --filter @noqueue/api check-types
pnpm --filter @noqueue/web check-types
pnpm --filter @noqueue/contracts check-types
node --test apps/mobile/scripts/*.test.mjs
```

API usa D1 efímero, claves generadas exclusivamente para tests y MSW fail-closed:
ninguna llamada no simulada puede salir. No copiar `.dev.vars` reales. Frontend
simula plugin/proveedor en unit tests; las pruebas nativas previas del bloque1
siguen siendo la evidencia de instalación/Keychain/Keystore, no de entrega push.

Pendientes funcionales: proximidad, correcciones de estimación, política de alertas
ya entregadas y métricas operativas. No repetir toda la matriz web para estos
cambios; validar la nueva integración push y ejecutar regresión compartida.

## Referencias verificadas

- [Capacitor Push Notifications v8](https://capacitorjs.com/docs/apis/push-notifications)
- [Firebase Messaging iOS: configuración, tokens y auto-init](https://firebase.google.com/docs/cloud-messaging/ios/get-started)
- [FCM HTTPv1 y autorización](https://firebase.google.com/docs/cloud-messaging/send/v1-api)
- [Errores FCM](https://firebase.google.com/docs/cloud-messaging/error-codes)
- [APNs token authentication](https://developer.apple.com/documentation/usernotifications/establishing-a-token-based-connection-to-apns)
- [Peticiones APNs](https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns)
- [Compatibilidad Node.js en Workers](https://developers.cloudflare.com/workers/runtime-apis/nodejs/)


## Estado de proveedores — 20/10/2026 (registro histórico)

Configuración realizada mediante las sesiones Chrome del usuario y confirmación
específica para crear credenciales limitadas. **No desplegado ni enviado push.**

| Recurso | Estado |
| --- | --- |
| Apple team | LUMOSA S.A., `6VYYNUZPSH` |
| App ID iOS | `com.noqueue-app.ios`, explícito, Push Notifications habilitado |
| APNs Sandbox | `NoQueue APNs Sandbox`, Key ID `33FG9322FT`, solo ese topic |
| APNs Production | `NoQueue APNs Production`, Key ID `W666TVNM38`, solo ese topic |
| Firebase proyecto | `nq-app-f3127`, número `54689871019`, FCM HTTPv1 ya habilitado |
| Android app | `com.noqueue.app`, Firebase ID `1:54689871019:android:fd8fe3f8c5fdb49cbf73ee` |
| Cuenta FCM | `noqueue-push-sender@nq-app-f3127.iam.gserviceaccount.com`; rol mínimo asignado y una clave creada. Custodiada fuera de Git; RSA, OAuth y FCM validate_only verificados el21/10/2026, sin entrega |
| App Store Connect | Sin ficha creada; aviso de acuerdo pendiente para Account Holder. No se aceptó ningún contrato |

### Custodia

Claves `.p8` en `/Users/usuario/.config/noqueue/push/` (directorio0700,
archivos0600), junto con `metadata.json` que solo referencia rutas/IDs. No se
copian a `.dev.vars`, repositorio, bundles ni informes. No se imprimen contenidos,
JWT ni claves. Guardar un backup en el gestor de secretos de la organización
antes de depender de ellas: Apple permite descargarlas una sola vez.

`google-services.json` es configuración cliente, no credencial de servidor; se
instaló en `apps/mobile/android/app/` y se excluye de Git por entorno. Todavía no se ha creado
una app Firebase iOS ni subido claves APNs a Google. El código ahora incluye
FirebaseMessaging iOS; la configuración cloud sigue pendiente y push OFF.

### Bloqueo FCM anterior: resuelto (IAM, custodia y validación sin entrega)

Anteriormente la sesión de Johan tenía solo **Editor**. Google Cloud rechazó la asignación de
permisos de proyecto por falta de `resourcemanager.projects.setIamPolicy`; crear
un rol personalizado también está deshabilitado. El propietario del proyecto
mostrado es Alberto. No se cambian roles del usuario ni se utiliza la cuenta
Firebase Admin SDK (tiene permisos ajenos a push).

Pasos inicialmente pendientes (creación/asignación ya completadas; ver registro nuevo):

1. Crear el rol personalizado `noqueueFcmSender` con la definición en
   `docs/runbooks/noqueue-fcm-sender-role.yaml` (solo `cloudmessaging.messages.create`).
2. Asignarlo **únicamente** a
   `serviceAccount:noqueue-push-sender@nq-app-f3127.iam.gserviceaccount.com`
   en el proyecto `nq-app-f3127`.
3. Después generar una clave JSON de esa cuenta y custodiarla fuera de Git. No
   ampliar a Owner/Editor/Firebase Admin, ni crear claves de la cuenta Admin SDK.

No se generó una clave FCM mientras faltaban permisos utilizables. El permiso mínimo se
contrastó con la [documentación IAM de FCM](https://docs.cloud.google.com/iam/docs/roles-permissions/firebasecloudmessaging).
No hay activación automática al resolver IAM: faltan los gates de transporte y
entrega, y una autorización separada de despliegue.

### Cambios locales y límites de la validación

- Xcode Debug/Release y runner/tests usan `com.noqueue-app.ios` y el team correcto.
  Capacitor copia/sincroniza por plataforma con `NOQUEUE_NATIVE_PLATFORM`; no usar
  un `cap copy` genérico para ambos IDs. Para exportar manualmente iOS, pasar
  `NOQUEUE_NATIVE_PLATFORM=ios`. Los scripts del paquete ya lo hacen.
- El bundle iOS anterior de simulador (`com.noqueue.app`) no se desinstala ni migra.
  El nuevo ID es otra aplicación; no afirmar continuidad de Keychain entre IDs.
  La evidencia previa del bloque1 sigue válida para sus flujos; firma y continuidad
  del bundle definitivo deberán comprobarse antes de beta.
- Android deshabilita auto-init FCM y Analytics por manifest. El plugin habilita
  registro solo al activar push explícitamente. La configuración cliente por sí
  sola no debe generar token. Confirmado también en manifest del APK compilado.
- Validación offline de ambas `.p8`: permisos0600, P-256, firma/verificación local;
  **no** demuestra autenticación/entrega de APNs. No se envían peticiones APNs/FCM
  ni se obtienen tokens OAuth de proveedor.
- Compilaciones Debug Android e iOS simulador sin firma correctas. No instalaron
  ni arrancaron apps, no registraron dispositivos y no generaron perfiles/certificados.
- Faltan firma de dispositivo, transporte APNs HTTP/2 desde Workers, credencial
  validación real de la credencial FCM y prueba física. Push backend/frontend sigue OFF.


## 20/10/2026 — Desbloqueo IAM y clave FCM (registro histórico)

El pendiente de descarga/validación de esta entrada quedó resuelto el21/10/2026; ver registro posterior.

- Verificado tras recargar Chrome: `sosa.johan@gmail.com` conserva Editor y tiene
  Administrador de IAM del proyecto y Administrador de funciones, concedidos por
  Alberto. No se han añadido ni eliminado roles del usuario en esta intervención.
- Con confirmación explícita nueva, creado el rol
  `projects/nq-app-f3127/roles/noqueueFcmSender`, GA/habilitado, con **solo**
  `cloudmessaging.messages.create`. Asignado exclusivamente a la cuenta dedicada;
  no se ha usado la cuenta Firebase Admin SDK ni roles Firebase Admin/Editor.
- Creada una única clave activa, ID `101b0cca37d37fd840dd7207bbb35f612bc5a74b`.
  Google confirmó la descarga `nq-app-f3127-101b0cca37d3.json`.
- **Pendiente**: localizar el archivo en el equipo, custodiarlo en
  `/Users/usuario/.config/noqueue/push/` (directorio0700, archivo0600) y validar.
  La confirmación del navegador no prueba por sí sola que tengamos el archivo.
  No se encontró por nombre en Downloads y las carpetas locales revisadas; se ha
  pedido al usuario su ruta. No copiar el contenido al chat ni crear otra clave.
- Primer intento: error desconocido de Google, seguimiento `c7214841219216701`.
  Antes de reintentar se recargó la lista y se comprobó que no existía ninguna
  clave. El segundo intento creó la única clave anterior; no hay duplicados.
- Evidencia local sin secretos: `reports/push-setup/fcm-iam-granted.png` y
  `fcm-key-created.png`. No equivale a prueba de autenticación/entrega.
- Android corresponde al proyecto `nq-app-f3127` y paquete `com.noqueue.app`;
  auto-init FCM y Analytics siguen deshabilitados. `.dev.vars` no contiene clave
  privada FCM ni push habilitado. No se han cargado secretos en Workers.

### Comprobador de credencial sin entrega

`apps/api/scripts/check-fcm-credential.mjs` es una herramienta de operador, no
forma parte del Worker ni del bundle de app. Rechaza otro proyecto/cuenta,
endpoint OAuth distinto y archivos dentro del repositorio o con permisos amplios.
Por defecto solo comprueba RSA y firma/verificación local. No imprime PEM, JWT,
token OAuth ni cuerpos de error del proveedor.

```bash
# Siempre sin red:
node --test apps/api/scripts/check-fcm-credential.test.mjs
node apps/api/scripts/check-fcm-credential.mjs /ruta/segura/clave.json
# Solo tras disponer del archivo y autorización de validación con Google:
node apps/api/scripts/check-fcm-credential.mjs /ruta/segura/clave.json --validate-only
```

El segundo modo obtiene OAuth con scope `firebase.messaging` y usa siempre
`validate_only: true`, sin token de dispositivo, con topic sintético aleatorio,
TTL0, timeout y redirecciones prohibidas. No existe opción de envío real.
Google documenta que [validate_only prueba sin entregar el mensaje](https://firebase.google.com/docs/reference/fcm/rest/v1/projects.messages/send).
No demuestra transporte desde Workers, registro/dispositivo ni entrega física.

Pruebas de esta intervención: **5/5** del comprobador (claves sintéticas), **22/22**
push API con proveedores simulados y tipos API correctos. La comprobación con la
clave real **no se ha ejecutado** mientras falta localizar el JSON.
Tras completar custodia/validación, Alberto debe retirar los **dos roles temporales**
del usuario, conservando Editor y el rol mínimo de la cuenta de servicio.
Sin despliegues, migraciones remotas, activación de push ni notificaciones reales.


## 21/10/2026 — Custodia y validación real FCM completadas

- Archivo localizado en Downloads según indicación del usuario. Verificados tipo
  service_account, proyecto, email y key ID antes de moverlo; no se generó otra clave.
- Movido a `/Users/usuario/.config/noqueue/push/nq-app-f3127-101b0cca37d3.json`:
  archivo0600, directorio0700 y sin copia restante en Downloads. `metadata.json`
  actualizado sin secretos, estado `validated_no_delivery`, push_enabled=false.
- Firma/verificación RSA local: **passed**.
- OAuth Google con scope `firebase.messaging`: **passed**.
- FCM HTTPv1 con `validate_only: true`, topic sintético aleatorio, sin token de
  dispositivo y TTL0: **passed**. No se ha intentado entregar ninguna notificación.
- Evidencia sin secretos: `reports/push-setup/fcm-credential-validation.json`,
  fechaUTC `2026-10-21T05:56:55.154Z` (07:56:55 Europe/Madrid).
- Esto confirma credencial y autorización FCM para la petición probada, **no**
  entrega física ni ejecución desde Workers. No se han cargado secretos remotos,
  activado registros/dispositivos, desplegado ni aplicado migraciones remotas.

Ya puede solicitarse a Alberto retirar de Johan Administrador de funciones y
Administrador de IAM del proyecto, conservando Editor. La cuenta FCM debe conservar
solo NoQueue FCM Sender; no quitarle ese rol. No se han retirado permisos en esta
intervención. Guardar backup en el gestor de secretos de la organización antes de
usar la clave en un entorno autorizado; no subirla a Git, apps, chat o documentos.

## 21/10/2026 — APNs e iOS: validación local sin notificaciones (histórico, anterior a FCM iOS)

### Cambios aplicados

- `APNS_TRANSPORT_VERIFIED` ausente/false bloquea disponibilidad iOS, registro y
  dispatch aunque estén las claves. Android sigue su configuración independiente.
  El bloqueo no consume reintentos ni invalida tokens existentes; la caducidad
  normal del outbox sigue vigente. Los tests fijan true solo con red simulada.
- Xcode declara la capacidad Push en el proyecto. Ajustes **resueltos**, no solo
  búsqueda textual: `com.noqueue-app.ios`, team `6VYYNUZPSH`, Debug/development,
  Release/production; simulador sin entitlement de dispositivo.
- `presentationOptions: []` explícito y copiado a iOS: en foreground el listener
  refresca el turno sin banner/sonido/badge duplicados. Conserva el comportamiento
  previo del plugin. No se añade `remote-notification` a background modes:
  enviamos alertas, no silent/data-only push. No se pide permiso al arrancar.
- Comprobador de firma futura: verifica integridad con codesign y coteja perfil
  local/entitlements/identidad/entorno/caducidad. Rechaza simulador, Release
  depurable y app sin firma. No sustituye validación Apple ni entrega física.

### Comandos reproducibles, sin entrega

```bash
# Offline por defecto. Ambas claves permanecen fuera de Git, 0600/directorio0700.
node apps/api/scripts/check-apns-local.mjs /Users/usuario/.config/noqueue/push
# Opcional, conexión Node a endpoints Apple fijos: TLS + HTTP/2 SETTINGS solamente.
# No session.request(), token de dispositivo, provider JWT ni envío de claves.
node apps/api/scripts/check-apns-local.mjs /Users/usuario/.config/noqueue/push --probe-transport

# Requiere Xcode y dependencias SPM locales ya resueltas. Solo lee configuración.
node apps/mobile/scripts/check-ios-push.mjs
# Solo cuando exista una app de dispositivo realmente firmada (no creada aquí):
node apps/mobile/scripts/check-ios-push.mjs --app /ruta/App.app --environment production
# Para firma development usar --environment development, no "sandbox".

node --test apps/api/scripts/check-*-*.test.mjs apps/mobile/scripts/*.test.mjs
WRANGLER_LOG_PATH=/tmp/noqueue-wrangler-logs pnpm --filter @noqueue/api exec vitest run src/features/mobile
pnpm --filter @noqueue/web test push-registration NativePush
```

La auditoría de ajustes usa `-disableAutomaticPackageResolution -skipPackageUpdates`,
no `-allowProvisioningUpdates`. Nunca genera certificados, perfiles o registros
APNs. Al examinar un perfil extrae solo los campos necesarios: un plist completo
con fechas/certificados no se puede convertir directamente a JSON con plutil.
Los comandos no imprimen claves, JWT, tokens, perfiles completos ni errores crudos.

### Evidencia y alcance

- Ambas `.p8`: P-256 y firma/verificación IEEE-P1363 de 64 bytes correctas.
- Sandbox y Production: TLS1.3, ALPN `h2`, SETTINGS remoto recibido desde **Node
  22 local**, cero peticiones HTTP. No prueba que las claves sigan habilitadas
  en Apple ni autoriza a marcar verificado el transporte Worker.
- Workerd instalado: `node:http2.connect()` no implementado, comprobado sin URL
  conectable. La [documentación Cloudflare](https://developers.cloudflare.com/workers/configuration/compatibility-flags/#enable-nodehttp2-module)
  también lo describe como stub. No se ha implementado un relay ni cambiado a
  Firebase iOS; ambas alternativas requieren decidir arquitectura si `fetch`
  en el runtime destino no resulta viable.
- Xcode27.1: Release/iphoneos y Debug/iphonesimulator compilan con
  `CODE_SIGNING_ALLOWED=NO`. No se instalaron/arrancaron apps ni registraron
  dispositivos. La auditoría rechaza correctamente el Release unsigned como
  prueba de firma. Sus assets siguen siendo **locales, no distribuibles**.
- Tests: API móvil56/56 (incluye push27/27), cliente push15/15 con jsdom,
  tooling33/33; tipos API/web/mobile correctos. La invocación inicial de tests
  React sin jsdom falló por `document is not defined`; corregida usando el script
  oficial `pnpm --filter @noqueue/web test`, sin modificar código del cliente.
- Evidencia local ignorada por Git: `reports/push-setup/apns-offline-validation.json`,
  `apns-local-transport.json`, `ios-push-configuration.json`, `ios-local-builds.json`.
  Logs de builds/tests en `/tmp/noqueue-push-*` y `/tmp/noqueue-apns-tests.log`.

**Pendiente, no marcar como validado:** transporte desde Worker destino,
credencial/autorización APNs real, certificado/perfil y entitlement del artefacto
firmado, entrega/background/cold-start/rotación en dispositivo físico. Antes de
cambiar gates hace falta autorización y evidencia por entorno. No hubo despliegue,
migración remota, nuevo secreto, modificación IAM ni notificación real.

## 21/10/2026 — Integración FCM iOS implementada y validada solo en local

### Cambios vigentes

- Paquete Capacitor propio `@noqueue/native-fcm` (solo iOS), enlazado con SPM;
  FirebaseMessaging12.7.0 fijado, deployment target iOS15. No SDK Firebase JS,
  Firebase Auth, Analytics ni segundo delegado de UNUserNotificationCenter.
- AppDelegate entrega APNs a Capacitor como antes; el puente lo asocia manualmente
  con Firebase y solo emite el FCM validado. Ignora token en caché antes de enlazar
  APNs, deduplica rotaciones y descarta callbacks de sesiones detenidas.
- `pause` cancela callbacks sin revocar; `stop` borra token FCM solo si Firebase
  ya estaba inicializado. Revocación backend precede borrado nativo. Errores son
  genéricos y reintentables; no se registran tokens ni detalles del proveedor.
- Una respuesta tardía de permisos/readiness no puede iniciar registro después
  de desmontar el shell. No cambia NoQueueVault, alta, turno único ni navegación.
- Schema iOS exige `provider:fcm`; conserva mayúsculas y rechaza cuerpo APNs
  antiguo. API/dispatcher exigen gate específico iOS. Migración0032 probada con
  fixtures: preserva identidad/turnos/Android/avisos aceptados y retira APNs legacy.
- Configuración cliente opcional: build sin plist funciona con push apagado. El
  script Xcode elimina plist copiado obsoleto y valida IDs si se añade en el futuro.
  SDK no se configura sin gate nativo + configuración válida + permiso del SO.

### Evidencia local de esta iteración

| Comprobación | Resultado / alcance |
| --- | --- |
| API móvil en workerd/D1 efímero | 61/61, proveedores y OAuth simulados |
| Web completa (jsdom) | 667/667, sin cambios de UI |
| Contrato push | 2/2 |
| Tooling móvil | 29/29, incluye lifecycle Swift con 23 aserciones sin SDK/red |
| Tipos | API, web, mobile y contracts correctos |
| Build web + sync | Correctos, API loopback y push/analytics OFF |
| iOS simulador Debug + XCTest | 1/1 smoke real: puente inaccesible con OFF, Firebase no inicializado, vault sin cambios |
| iOS Release iphoneos | Compila sin firma; no demuestra perfil/entitlement firmado |
| Android Debug | Compila; no se instala ni registra dispositivo en esta iteración |
| Auditoría Xcode | Bundle/team/entitlements correctos; native gate/auto-init/swizzling/Analytics OFF, plist ausente |

El smoke mide **no modificación** del vault por el puente apagado, no reemplaza
las pruebas históricas de alta/recuperación ni valida un token FCM real.
El SDK trae Firebase Installations como dependencia de Messaging: ese identificador
futuro es técnico del proveedor, nunca reemplaza la identidad de NoQueue.

```bash
# Incluye pruebas Swift de lifecycle con driver falso; no inicializa Firebase.
node --test apps/mobile/scripts/*.test.mjs
# Smoke nativo acotado: exige assets locales con VITE_MOBILE_PUSH_ENABLED=false,
# NoQueueFcm.enabled=false. El test21 funciona con o sin configuración cliente.
# Con el plist real instalado, usar el test22 para comprobar también su inclusión.
# Arrancar previamente el simulador dedicado, no borrar sus datos.
xcodebuild -project apps/mobile/ios/App/App.xcodeproj -scheme LocalSmoke \
  -configuration Debug -destination 'platform=iOS Simulator,id=F0DF57A2-69C9-471A-BCCB-1610F9917137' \
  -derivedDataPath /tmp/noqueue-fcm-ios -clonedSourcePackagesDirPath /tmp/noqueue-mobile-spm \
  -disableAutomaticPackageResolution -skipPackageUpdates CODE_SIGN_IDENTITY=- \
  -parallel-testing-enabled NO \
  -only-testing:AppLocalTests/LocalSmokeTests/test21FcmDisabledDoesNotInitializeOrChangeIdentity test
```

Evidencia local sin secretos: `reports/push-setup/fcm-ios-local-validation.json` y
`fcm-ios-configuration.json`; logs `/tmp/noqueue-fcm-*`; XCTest `.xcresult` bajo
`/tmp/noqueue-fcm-ios/Logs/Test/`. Simulador detenido al terminar.

**No realizado:** app Firebase iOS/configuración cliente, upload de claves APNs,
OAuth o validación real con credenciales en esta iteración, migraciones remotas,
despliegues, activación, notificaciones o firma de dispositivo. Las credenciales
existentes no se han leído ni modificado. La entrega sigue pendiente: configurar
cloud, revisar privacidad, firmar y ejecutar pruebas físicas en entorno autorizado.

## 21/10/2026 — Configuración Firebase iOS en Chrome (histórico parcial; resuelto abajo)

Creada NoQueue iOS con bundle `com.noqueue-app.ios`, ID
`1:54689871019:ios:bf4f2ec894b1aa99bf73ee`; Team ID `6VYYNUZPSH` guardado.
No se ha creado otra cuenta, cambiado facturación/IAM ni introducido App Store ID.
La consola admite dos espacios APNs (desarrollo/producción). Diálogo preparado
para Sandbox; subida de claves pendiente de confirmación de delegación.

Descarga oficial solicitada desde el asistente, sin evento/archivo local confirmado.
La página interna de descargas no es accesible mediante la herramienta de navegador;
se pide al usuario una ruta local, sin intentar sortear esa restricción. No reconstruir
la configuración ni crear otra app. Mantener todos los gates OFF.

## 21/10/2026 — Configuración Firebase iOS/APNs completada sin envíos

Después de confirmar la delegación a Firebase, se han cargado las claves P8
existentes: desarrollo `33FG9322FT`, producción `W666TVNM38`, ambas del equipo
`6VYYNUZPSH` para `com.noqueue-app.ios`. Consola confirma ambas filas guardadas.
No se crean nuevas claves ni se cambian IAM, facturación o restricciones Apple.

La extensión Chrome rechazó inicialmente fileChooser.setFiles por falta de permiso
de archivos. El usuario activó «Allow access to file URLs»; después se cargaron
por el selector documentado, sin métodos alternativos ni secretos en logs.

Dos archivos de configuración cliente aparecieron en Downloads y eran idénticos.
Se validaron IDs y formato de API key (sin imprimirla), instalando una copia 0600
en `apps/mobile/ios/App/App/GoogleService-Info.plist`, ignorada por Git. Descargas
conservadas. Las P8 originales siguen fuera de Git; no se copiaron a bundles.

### Validación efectuada ahora

- `node --test apps/mobile/scripts/*.test.mjs`: **30/30**. Nuevo auditFirebaseClient
  verifica proyecto/bundle/sender/App ID y formato de API key, sin red ni SDK.
- Auditoría Xcode: configuración cliente validada offline, todos los gates OFF.
- Build web con API loopback y push/analytics OFF; sync solo iOS.
- Debug/simulador y Release/iphoneos sin firma: builds correctos con plist real.
- XCTest `test22FcmConfiguredButDisabledDoesNotInitializeOrChangeIdentity`: **1/1**,
  coteja plist dentro de app y prueba puente real: Firebase no inicializado, start
  rechazado por gate y Keychain sin cambios. No obtiene token ni pide permiso.
- Ambos bundles cotejados con origen; flags OFF y sin archivos P8.
- Simulador dedicado detenido tras prueba. No cambios en lógica API/web/Android;
  regresiones completas de la implementación anterior siguen como evidencia
  histórica, no se afirman repetidas en este paso de configuración.

Para repetir el smoke con configuración instalada, usar el comando del test21
arriba cambiando only-testing a
`AppLocalTests/LocalSmokeTests/test22FcmConfiguredButDisabledDoesNotInitializeOrChangeIdentity`.
Mantener gates OFF; no hacer pruebas de entrega ni activar SDK como parte del audit.

Evidencia: `reports/push-setup/firebase-apns-configured.png`,
`firebase-ios-console-validation.json`, `firebase-ios-client-audit.json`; logs
`/tmp/noqueue-firebase-ios-*` y `/tmp/noqueue-firebase-config-tests.log`.

**Pendientes reales:** certificado/perfil firmado, privacidad/declaraciones stores,
FCM desde runtime destino y pruebas físicas con token/rotación/background/cold-start
en entorno autorizado. No despliegue, migración remota, activación de gates,
registro FCM de dispositivos ni notificación real durante esta configuración.


## 2026-10-21 — Smoke real autorizado exclusivamente al iPhone

El usuario autoriza notificaciones de prueba **solo a su iPhone**, sin despliegues.
No autoriza campañas, otros destinatarios, staging/producción ni WhatsApp.
La autorización sustituye «sin envíos» únicamente para este smoke; las evidencias
anteriores sin avisos conservan su alcance histórico.

### Aislamiento

- `scripts/dev-mobile-push-real.mjs` es un proceso separado de `dev-mobile.mjs`.
  Usa `test/mobile-push-real-worker.ts`; **nunca desplegar** este entrypoint.
- D1 nueva/efímera, fixtures sintéticos, APP_ENV=local, WhatsApp y experimentos OFF.
  No lee `.dev.vars` ni usa bindings remotos. HTTPS en una IPv4 privada concreta;
  control de operador en127.0.0.1:8789 con bearer aleatorio, no accesible desde LAN.
- Credencial existente fuera Git y permisos0600/directorio0700. Config temporal
  privada fuera del repositorio, eliminada al cerrar normalmente. Si el proceso
  termina abruptamente, retirar su directorio `/tmp/noqueue-real-push-*` identificado
  por esa ejecución; no imprimir su contenido ni copiarlo a informes.
- Todo egress bloqueado salvo OAuth Google con scope firebase.messaging y FCMv1
  del proyecto configurado. Sin redirects. OAuth requiere autorización vigente.
- Tras confirmar visualmente el código en **ese iPhone**, `/call-once` exige una
  única entrada y un único registro iOS/FCM del mismo propietario. Fija los hashes
  de instalación/token y entryId; no acepta tokens ni destinos arbitrarios.
- El comando real del coordinador llama al turno. La política compara token,
  propietario, outbox, versión, estado called y TTL; consume atómicamente un
  presupuesto de **un intento antes de salir a FCM**. Autorización caduca en2min;
  tampoco un timeout permite reenvío automático. Temas/condiciones y otros
  dispositivos/proyectos/avisos quedan bloqueados. Cualquier segundo smoke exige
  una ejecución nueva y volver a identificar el dispositivo, no rearmado silencioso.
- Evidencia solo con contadores/códigos/estados, sin tokens, claves ni capabilities.
  `/disarm` elimina registro y descarta pendientes antes del cierre. Límite90min
  del proceso por si se interrumpe la asistencia; no deja un emisor permanente.

### Operación local

```bash
NOQUEUE_REAL_PUSH_SMOKE=only-my-iphone NOQUEUE_LOCAL_HOST=192.168.1.38 \
NOQUEUE_FCM_CREDENTIAL=/ruta/privada/fuera-del-repo/cuenta.json \
pnpm --filter @noqueue/api exec node scripts/dev-mobile-push-real.mjs
```

La IP es un ejemplo de esta ejecución: verificar interfaz/certificado antes de
reutilizarla. El perfil de CA temporal debe estar confiado en el teléfono.
Construir web con API HTTPS privada, `VITE_MOBILE_PUSH_ENABLED=true`, Analytics OFF;
`cap copy ios` sin live reload. Solo en el `capacitor.config.json` **generado/ignorado**
activar `plugins.NoQueueFcm.enabled=true` antes de compilar Debug Development.
No cambiar el gate false del `capacitor.config.ts` compartido. Auditar firma,
APNs development, bundle/team y dispositivo antes de instalar encima, sin borrar
app/Keychain. Este artefacto no sirve para tiendas.

1. Alta anónima UI → Activar avisos → permiso iOS; confirmar código y CTA habilitado.
2. Poner app en segundo plano/bloquear iPhone antes del envío.
3. En el Mac: `node apps/api/scripts/local-push-control.mjs evidence`.
4. Una vez confirmado destinatario: `node apps/api/scripts/local-push-control.mjs call-once CODIGO`.
5. `evidence`: comprobar outbox accepted y un intento; **no equivale a recepción**.
6. Usuario confirma alerta real; pulsa esa alerta, no el icono de la app.
   Verificar pantalla del mismo turno llamado y GET propietario de notice200
   seguido de lectura del turno. Sin esa evidencia, apertura queda pendiente.
7. `disarm`, evidencia final, restaurar build/gates OFF y `shutdown` para cerrar API.
   Preferir shutdown a SIGINT: Wrangler puede cerrar su runtime antes de que
   termine la escritura asíncrona de evidencia y limpieza de archivos temporales. Recordar
   retirada de confianza temporal cuando ya no se necesite.

Pruebas del filtro usan claves/tokens ficticios y respuestas MSW; no hacen envíos.
Archivos de evidencia ignorados: `reports/ios-device/push-real/`.


### Resultado físico

- Intento1, C9NKZ3: FCM accepted,1intento; usuario tenía app abierta, sin banner
  (configuración foreground esperada). No se usa como evidencia de apertura push.
- Intento2, sesión nueva H6RZ76: teléfono bloqueado confirmado **antes** de enviar.
  FCM accepted,1intento; notificación visible en lockscreen (14:50:37UTC).
  Usuario la pulsa:1GET notice autenticado200 seguido de lecturas del turno,
  captura «¡Es tu turno!» con el mismo H6RZ76. **Entrega y apertura PASS**.
- Ambas sesiones: solo un registro iOS y un turno por sesión; cero contactos,
  consentimientos y WhatsApp. Dos envíos en total al mismo iPhone, no reintentos
  automáticos ni otro destinatario. Sin despliegues/migraciones remotas.
- No extrapolar a proceso terminado, TestFlight/APNs production, Android físico,
  rotación/revocación real del token, ni runtime Worker remoto. No se promete
  entrega garantizada a partir de este smoke.

- Cierre realizado: registro servidor eliminado, presupuesto agotado, build nativo
  y web OFF restaurado e instalado encima. El mismo H6RZ76 se recuperó sin CTA
  push, acreditando continuidad de identidad. API cerrada,8788/8789 sin listeners,
  archivos temporales de credencial/control retirados (original privado conservado).
  El permiso iOS concedido no se ha modificado; con gates OFF no inicializamos FCM.
  La app sigue apuntando a API local y necesita reiniciarla para futuras pruebas.
  El perfil CA temporal se retira manualmente cuando ya no se vaya a usar.
