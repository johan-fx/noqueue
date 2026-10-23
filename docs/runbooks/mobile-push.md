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

- `0030_mobile_push.sql` introdujo registro y outbox separados de WhatsApp.
  `0033_mobile_push_lifecycle.sql` sustituye su trigger por intents explícitos en
  la misma transacción del dominio/proyección. Incluye acercamiento, retrasos,
  mejoras, llamadas y cancelación externa. `service_ended` se conserva para leer
  historial/outbox antiguos; el cierre físico actual retiene los turnos en espera
  como `manual_only` y no genera un aviso de cierre. Solo para instalación
  con registro habilitado y gate ON. No crea contactos ni consentimientos WhatsApp.
- API móvil, detrás de la misma identidad/CORS/cuotas del bloque1:
  - `GET /api/v1/mobile/push/registration`: disponibilidad por plataforma y estado,
    sin devolver tokens.
  - `POST .../registration`: iOS `{platform:"ios", provider:"fcm", token, locale}`;
    Android conserva `{platform:"android", token, locale}` (provider fcm opcional);
    upsert propietario, token cifrado con clave exclusiva, HMAC único.
  - `POST .../revoke`: elimina token y descarta pendientes; idempotente.
  - `GET .../notices/:id`: resuelve capability solo con instalación propietaria y
    tenant activo, incluso si terminó el turno. El ID de aviso **no** autoriza.
- App: listeners antes de registro, permiso tras alta confirmada (deduplicado por
  clave de inscripción) o desde CTA «Activar». Sin solicitudes al arrancar/recuperar
  un turno ni insistencia automática tras rechazo. Permiso SO y registro FCM separados;
  reconciliación en resume/turno activo, revocación interna, errores recuperables y timeout.
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
Una llamada espera como máximo su arrival deadline; avisos intermedios/terminales TTL10min.
Lease60s, máximo5 intentos, backoff60s exponencial y `Retry-After` respetado.
Los snapshots v2 se validan por evento, ciclo y proyección, no por igualdad
`estado=tipo`. Las prórrogas durables sobreviven a revisiones ajenas y se conservan
en orden mientras sean válidas; una recuperación del retraso las invalida.
El lector legacy v1 mantiene la comprobación original de versión/estado.
Se descarta al vencer TTL o revocar/suspender destinatario.
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
- En Android 12 y anteriores, `PushNotifications.checkPermissions()` devuelve concedido
  aunque el usuario bloquee las notificaciones en ajustes. La app ahora combina ese
  estado con `LocalNotifications.areEnabled()` y el canal `queue-updates` (importance0
  implica bloqueo). El registro habilitado sigue sin demostrar entrega. La prueba
  física del flujo nuevo y de cambios de permiso continúa siendo necesaria.

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
  FirebaseMessaging12.7.0 fijado, deployment target iOS18 (alineado con la app).
  No SDK Firebase JS,
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

## Android físico — smoke local por USB (2026-10-21)

El opt-in `only-my-android` reutiliza el mismo filtro de egress, pero fija plataforma
Android, API HTTPS loopback **8790**, control loopback **8791** y evidencia
`reports/android-device/push-real/`. No sustituye ni reinicia la API iPhone8788
ni su Vite5173. D1 efímera, WhatsApp OFF, FCM iOS OFF, un destinatario propietario
confirmado y **un solo intento** consumido atómicamente antes de FCM. No despliega.

```bash
NOQUEUE_REAL_PUSH_SMOKE=only-my-android \
NOQUEUE_FCM_CREDENTIAL=/ruta/privada/fuera-del-repo/cuenta.json \
pnpm --filter @noqueue/api exec node scripts/dev-mobile-push-real.mjs
adb -s DISPOSITIVO_AUTORIZADO reverse tcp:8790 tcp:8790
```

- Verificar `adb devices -l` y aceptar depuración USB en el dispositivo correcto.
- Config Firebase Android local/ignorada para `com.noqueue.app`. Construir web con
  `VITE_API_URL=https://127.0.0.1:8790`, `VITE_MOBILE_PUSH_ENABLED=true`, Analytics OFF;
  sync Android y Debug con `-PnoqueueLocalTlsDir=/ruta/repo/reports/android-local/tls/res`.
  CA restringida a127.0.0.1, sin HTTP ni desactivar validación TLS; no instalar CA
  globalmente en el dispositivo. Nunca usar este artefacto en tienda.
- Instalar encima (`adb install -r`), no desinstalar ni borrar vault/Keystore.
  Android usa Capacitor FCM; el gate `NoQueueFcm` es iOS y permanece false.
- Buscar «local», alta con nombre ficticio, verificar recuperación después de
  reiniciar y activar avisos. Confirmar código visible y dispositivo bloqueado.
- Anteponer `NOQUEUE_REAL_PUSH_SMOKE=only-my-android` a **todos** los comandos
  `local-push-control.mjs evidence|call-once CODIGO|disarm|shutdown`.
- Separar FCM accepted de alerta visible y apertura autenticada del mismo turno.
  No inyectar el evento push ni navegar artificialmente para acreditar apertura.
- Al cerrar: desarmar, retirar registro, restaurar build push OFF sin borrar datos,
  shutdown, retirar reverse8790 y forward de inspección. No tocar los puertos
  ni procesos del entorno iPhone. Evidencias y credenciales siempre fuera Git.

La prueba en Android12 no cubre el diálogo de permiso de Android13+, distribución
Google Play, rotación del token ni recepción con proceso terminado/force-stopped.

### Resultado Android físico de esta ejecución

Samsung SM-T500, Android12, WebView154.0.8037.106: alta anónima y recuperaciónCOLD
PASS; registroFCM desde opt-inPASS; notificación con tablet bloqueada confirmada
por usuario,1registro SO canalqueue-updates, FCMaccepted/1attempt. Pulsación real
abre S6UMKJ «¡Es tu turno!» y produce1resolución autenticada de notice200.
Desactivar avisos elimina registro; cancelaciónUI deja cancelledv2 y vuelve al
inicio. BuildOFF reinstalado sin borrado; APItemporal/control/túneles cerrados.
**Un envío real total, solo a esta tablet**; sin WhatsApp ni despliegues.
Informe `reports/android-device/push-real/result.json`; capturas en su directorio
padre. APIiPhone8788/Vite5173 existentes preservados.


## 21/10/2026 — Permiso tras inscripción y activación desde ajustes

- El éxito de `PublicQueue.submit` notifica al proveedor push con la clave idempotente,
  después de confirmar/retirar la intención de alta. No espera al diálogo ni al registro.
  Errores de inscripción, recuperación de turno y conflictos409 no solicitan permiso.
- Primera solicitud desde el alta; un rechazo no abre ajustes automáticamente ni se
  repite al reabrir el turno. El CTA permite repetir si el SO lo admite o abre ajustes.
  No existe desactivación en la UI: se realiza en el sistema operativo.
- Bloque inferior naranja Figma572:10413, campana SVG local original24px y botón primario
  «Activar» debajo del texto. No aparece con permiso concedido, sin turno, al comprobar
  estado o con proveedor no disponible. Fallo técnico con permiso concedido: «Reintentar».
- Volver de ajustes comprueba permiso/presentación y renueva registro con turno activo
  o registro previo. Con bloqueo, invalida callbacks tardíos y revoca backend antes de
  borrar el token nativo. Una revocación fallida se reintenta sin marcar éxito.
- Plugins fijados: `capacitor-native-settings@8.2.0` (AppNotification y fallback App)
  y `@capacitor/local-notifications@8.3.1` (solo consulta de presentación Android).
  iOS usa APIs públicas de UIApplication. No se programan notificaciones locales.
  El manifest elimina SCHEDULE_EXACT_ALARM/USE_EXACT_ALARM heredados del plugin.
- Las pruebas visuales aisladas se ejecutan con
  `node tests/e2e/mobile/push-preview.mjs`: componentes reales, turno ficticio, permisos
  simulados y red fuera del servidor local bloqueada; capturas390/320px y comprobación768px.
  Salida `reports/push-activation/`. El fixture vive fuera de `src` y no entra al bundle.
- Esta implementación no activa gates, despliega, instala en dispositivos del usuario
  ni envía push reales. Las capturas simuladas no acreditan entrega ni diálogo nativo.

## Seguimiento completo — implementación local 21/10/2026

Esta sección sustituye el alcance antiguo de tres eventos, **no** amplía las
pruebas físicas ya realizadas. Migración 0033 aplicada únicamente en bases
efímeras de tests. Producción sigue apagada; no hay despliegue ni envío real
como parte de esta implementación.

Actualización funcional 22/10/2026: la finalización física de la ventana ahora
retiene turnos en espera como `manual_only` sin cancelarlos ni emitir `service_ended`.
El template y las filas históricas de outbox se conservan por compatibilidad. La
matriz y ejecución de cierre de abajo describen la implementación y prueba física
anteriores del 21/10; no son el comportamiento de aceptación actual.

### Matriz de equivalencia implementada

| WhatsApp / situación | Push / interfaz | Evidencia automatizada |
| --- | --- | --- |
| `queue_joined` | Solo pantalla; referencia inicial `screen` | lifecycle: alta sin outbox |
| `approaching` | Venue, espera conocida y recomendación | lifecycle: trayectorias iOS/Android |
| `delayed` ordinario | Umbral/cooldown compartidos, historial propio | lifecycle: cambio de configuración, recuperación |
| `delayed` por prórroga | Una identidad por secuencia/ciclo, ordenadas sin cooldown ordinario | lifecycle: tres prórrogas, mismo entry_version, reintento inmutable |
| `improved_wait_recommended` / `neutral` | Dos textos; ninguna llamada ficticia | lifecycle: ambas mejoras en estado waiting |
| `ready` / `improved_ready` | Dos textos tras asignación efectiva; destino y plazo en app | lifecycle: llamada normal/anticipada, cesión a sucesor móvil |
| `expired` | Expiración explícita; nueva inscripción desde app | lifecycle: vencimiento real del plazo |
| `cancelled_customer` | Solo pantalla, retirar pendientes | lifecycle: cancelación propia |
| `cancelled_staff` | Cancelación atribuida al establecimiento | lifecycle: cancelación por comando staff |
| `cancelled_unknown` | Texto neutral seguro | catálogo ES/EN; legacy conserva lector original |
| `service_ended` (histórico) | Solo compatibilidad/lectura de outbox previa; no se genera al cerrar físicamente | lifecycle: test histórico de mantenimiento de fin de servicio |
| Pasar turno / editar | Resultado en app y nueva referencia `screen` | lifecycle: esperando/llamado, con/sin sucesor, repetición y edición |
| Posposición staff | Sin evento push nuevo | `skip` actualmente rechazado como unsupported_action; estimación se prueba por cambios reales permitidos |
| Llegada / atención completada | Solo pantalla; descartar llamada pendiente | lifecycle: complete sin push |
| Confirmación WhatsApp / position_update / BAJA / STOP / botones | Sin equivalente push | alta sin WA y catálogo sin formato/footer/acciones inexistentes |

Archivos de pruebas: `apps/api/src/features/mobile/push/lifecycle.test.ts`,
`migration.test.ts`, `push.test.ts`, `provider.test.ts`; políticas del futuro
harness en `apps/api/test/local-push-lifecycle-policy.test.ts`.
No afirmar que `skip` está probado como posposición operativa: el dominio público
actual no lo permite. Si se habilita en otra fase, añadir su prueba de integración.

### Referencias, persistencia y compatibilidad

- `mobile_push_state` separa referencia `screen`/`sync` de aceptación `fcm`.
  Alta, edición y cesión propia no se etiquetan como aviso aceptado o leído.
- `queue_notice_reference` y `queue_notice_history` son adaptadores de lectura
  para reutilizar políticas; móvil no lee historial WhatsApp ni depende de
  teléfono, consentimiento, plantillas o versión de copy. Estimador sin cambios.
- Primera activación/reactivación sincroniza proyección actual y descarta backlog;
  refrescar/rotar token con registro activo no reinicia referencia ni pierde pendientes.
- Snapshot v2 congela venue, locale, variante y contexto; no guarda firmas de
  botones WhatsApp. Navegación sigue `{type:"queue-update",notificationId}`.
- Clave única por evento/ciclo/revisión/episodio/secuencia, no solo versión del turno.
  Las prórrogas se refrescan antes del primer intento y congelan copia al reintentar.
- La migración conserva IDs, estados, intentos y fechas de avisos v1. No reconstruye
  historia ni reenvía por sí misma. Desactivar mediante gate existente; **no**
  reactivar el trigger ni deshacer automáticamente la migración.
- Primer plano, permisos, resolución propietaria y consulta de estado actual no
  cambian. Sin banners duplicados, acciones rápidas nuevas o baja propia en la app.

### Harness físico separado — preparado, NO ejecutado

Requiere autorización específica por plataforma y escenario. No sustituye el smoke
anterior de una sola llamada. Entrypoint exclusivo `mobile-push-lifecycle-worker.ts`;
red denegada salvo OAuth/FCM fijados, un token/instalación/turno, sin topics.
La política consume el intento antes de egress; un timeout **no** permite reenviar
ese ID real. `NOQUEUE_PUSH_MAX_SENDS` permite reducir, nunca ampliar, el máximo
del escenario para respetar un presupuesto global de varias ejecuciones. Máximo total 20 y límites por tipo; ventana máxima 90 minutos.

| Escenario | Presupuesto máximo de envíos reales por ejecución |
| --- | --- |
| `normal` | approaching 1 + called 1 |
| `extensions` | approaching 4 + delayed 3 + called 1 |
| `improvements` | approaching 1 + improved 2 + called 1 |
| `yield` | approaching 2 + delayed 1 + called 2 |
| `expiry` | called 1 + expired 1 |
| `cancellation` | cancelled 1 |
| `closure` (escenario histórico, no repetir para el flujo actual) | service_ended 1 |

Comandos de referencia **para uso posterior autorizado**, desde raíz:

```bash
# Elegir SOLO una plataforma y un escenario; credencial privada fuera del repo.
export NOQUEUE_REAL_PUSH_LIFECYCLE=only-my-iphone # o only-my-android
export NOQUEUE_PUSH_SCENARIO=normal
# iPhone requiere también NOQUEUE_LOCAL_HOST con la IP LAN privada del Mac.
export NOQUEUE_FCM_CREDENTIAL=/ruta/privada/credencial.json
node apps/api/scripts/dev-mobile-push-lifecycle.mjs
# En otra terminal con las mismas variables, tras alta real y activación en app:
node apps/api/scripts/local-push-lifecycle-control.mjs arm ABC123
node apps/api/scripts/local-push-lifecycle-control.mjs step call
node apps/api/scripts/local-push-lifecycle-control.mjs evidence
node apps/api/scripts/local-push-lifecycle-control.mjs disarm
node apps/api/scripts/local-push-lifecycle-control.mjs shutdown
```

Precondiciones: autorización, certificado TLS confiado, app local conectada al puerto
correcto y gates exclusivamente locales, puertos libres (iOS8788/8789;
Android8792/8793 para lifecycle; el smoke conserva8790/8791). **No detener servicios ajenos** para liberarlos. El runner falla
cerrado si están ocupados. Registrar estado previo y plan de restauración antes de
cambiar app/permisos/túneles; no desinstalar ni borrar datos de la app habitual.

- Armar antes del primer evento (outbox vacía); un solo armado por DB efímera.
  No añadir manualmente filas a outbox. Call/complete/cancel/configuración usan el
  coordinador real; el cliente pasa/edita/abandona desde la app.
- `step average N` (2..15) solo en extensions/improvements/yield; `step refresh`
  mantiene usando reloj real. Extensions: esperar revisiones de seguridad o cambios
  reales, observar tres identidades, recuperación y nuevo acercamiento.
- Improvements: escenario inicia media6/acercamiento4. Para variante recomendada,
  esperar acercamiento y aceptación, luego `average 5`; para neutral, nueva ejecución
  autorizada y `average 5` antes del acercamiento. Respetar cooldown10min para otra
  corrección en la misma ejecución. Llamada temprana solo con `step call` efectivo.
- Yield: `step companion` crea un único acompañante sintético sin instalación ni
  WhatsApp; probar primero paso esperando, después llamada/paso llamado y nueva
  llamada del destinatario original. Sin companion cubre regreso a espera.
- Expiry: llamar y dejar vencer gracia2min. Cancellation: cancelar externamente.
  Closure: servicio real con fin aproximadamente8min tras arrancar; no tocar
  artificialmente service_ends_at. El runner rechaza ventana que cruce medianoche.
- Desarmar, capturar evidencia y shutdown siempre, incluso ante fallos. Se retiran
  registro/pendientes del entorno efímero y configuración temporal privada; la
  restauración de app/permisos/túneles es explícita y debe verificarse por operador.

### Acta física pendiente (repetir iPhone y Android)

Por evento registrar: escenario, versión app/SO, código sintético, notificationId,
created_at, attempted_at, accepted_at, hora de recepción **observada**, estado de
pantalla y apertura del turno correcto. El harness guarda generación/intento/
aceptación/resolución en `reports/{ios,android}-device/push-lifecycle/` (ignorado),
no token ni capacidad. `turnReadAfterNotice` es un contador agregado, no demuestra
correlación individual ni lectura humana: completar con observación visual.

1. Secuencia normal hasta llamada/llegada; prórrogas repetidas y recuperación.
2. Mejora neutral/recomendada, llamada anticipada, paso y nueva llamada.
3. Expiración, cancelación externa, cierre; ausencia de duplicados por acciones propias.
4. Segundo plano y bloqueo; primer plano actualiza sin banner/sonido duplicado.
5. Abrir desde proceso terminado (no confundir con force-stop del SO); aviso antiguo
   abre estado actual. Pérdida de red y recuperación sin perder hint.
6. Permiso rechazado, revocado, recuperado; Android12 y13+ por separado.
7. Comparar identidad y servicios antes/después; conservar datos ajenos.

Aceptación FCM **no equivale a recepción**. No prometer entrega garantizada ni
exactamente una recepción. TestFlight/APNs producción, distribución Android de
prueba, runtime desplegado y red externa siguen siendo otra fase con autorización
independiente. Los builds locales y mocks no acreditan ninguna de estas fases.

### Ejecución física Android de ciclo completo — 2026-10-21

Autorización posterior específica del propietario: solo su Samsung SM-T500,
Android12/API31, sin producción y con restauración. Entorno efímero HTTPS8792 /
control8793, independiente del servicio local8790 preexistente. Un receptor
fijado por ejecución, sin topics, sin reenvío real del mismo ID ni cron remoto.
Presupuesto global comunicado27; cada ejecución tiene además límite propio.
No se alteró el estimador de producción: el fixture normal usa umbral5min para
permitir una llamada normal después del acercamiento; otros fixtures conservan1.

Evidencia privada ignorada por Git:
`reports/android-device/push-lifecycle-session/` (IDs, tiempos, panel Android,
apertura mediante tap real, resolución autenticada y estados de dominio).
Los archivos de backup de APK/datos no deben publicarse.

Resultados físicos históricos registrados el 21/10, antes del cambio de retención
manual-only. Se conservan como evidencia de lo que ocurrió entonces, no como
expectativa de una nueva ejecución:

- Normal: acercamiento y llamada `ready` recibidos/abiertos, llegada completada.
  Una primera ejecución quedó interrumpida por PIN: ambos avisos se observaron
  bloqueados; tras desbloquear, el aviso antiguo abrió el estado **expirado**.
- Prórrogas: cuatro acercamientos intercalados con tres prórrogas distintas,
  todos recibidos/abiertos en orden. La llamada final fue aceptada por FCM, pero
  el observador no encontró aviso en el panel: **recepción visible no acreditada**,
  sin reenvío. No confundir este resultado parcial con ocho recepciones probadas.
- Mejora neutral: callback nativo real en primer plano, sin NotificationRecord
  para ese ID; no se simuló el evento. Llamada `improved_ready` recibida/abierta
  después de terminar el proceso con `am kill`, PID ausente y `stopped=false`.
  Esto **no** demuestra recepción después de «Forzar detención».
- Mejora recomendada: acercamiento → `improved_wait_recommended` →
  `improved_ready`, tres avisos recibidos/abiertos.
- Pasar: acción esperando sin push propio; después de llamada sin sucesor retorna
  a espera. El fixture inicial había puesto al acompañante delante y la aserción
  de cesión era incorrecta. Una ejecución separada, dentro del presupuesto de
  ese escenario, verificó cesión al sucesor y nueva llamada al receptor original.
- Abandono propio: confirmación en pantalla, cero nuevos registros outbox y cero
  intentos, con guard desarmado. No se emitieron mensajes WhatsApp en estos casos.

La ausencia de notificación en primer plano se comprobó visualmente/por registro
para la mejora neutral; no se instrumentó audio para medir ausencia de sonido.
Android13+, iPhone, todas las combinaciones de idioma/estimación desconocida,
rotación real de token y distribución remota no quedan acreditados por esta acta.

- Expiración: llamada y aviso `expired` recibidos/abiertos tras el plazo real de
  gracia2min; pantalla de expiración con opción de seleccionar lista nueva.
- Cancelación externa: texto push explícito del establecimiento. Se retiró solo
  el reverse8792 después de recibirlo, se abrió sin API y se restableció el túnel.
  El mismo notificationId se resolvió autenticado al reanudar, mostrando el estado
  terminal actual («Ya no estás en la lista de espera»). La aserción inicial del
  observador buscaba literalmente «cancelado» y se corrigió con esta evidencia;
  no hubo reenvío ni cambio del producto. No fue una pérdida de conectividad FCM.
- Permisos Android12: interruptor real NoQueue ON→OFF, `areEnabled=false`, CTA
  «Activar» visible y abre ajustes reales; OFF→ON y registro habilitado otra vez
  antes de armar el escenario. No demuestra el diálogo runtime de Android13+.
- Cierre (histórico): `service_ended` recibido/abierto a la hora real del servicio,
  pantalla «El servicio ha finalizado», sin outbox `cancelled` duplicada. El flujo
  actual retiene los turnos en espera y no envía este aviso.

**Cierre de ejecución:**24 intentos reales en total, todos aceptados por FCM,
por debajo del máximo27. Distribución por ejecución: normal interrumpido2,
normal completo2, prórrogas8, mejora neutral2, mejora recomendada3,
paso inicial1, paso con sucesor2, expiración2, cancelación1 y cierre1.
En esta ejecución del21oct la llamada final de prórrogas quedó sin recepción
visible acreditada; se resolvió en la comprobación autorizada del22oct, abajo.
Las otras llamadas en escenarios normal, mejora y paso sí se observaron. No se certifica
«todo el plan físico aprobado»: siguen pendientes Android13+, iPhone, variantes
adicionales y la fase remota; no se modifican gates para dar estos casos por hechos.

**Restauración verificada:** APK original idéntico por SHA256;53 archivos privados
idénticos al snapshot antes de relanzar, incluido vault;124 assets de build
idénticos al backup (sin contar metadatos AppleDouble del tar). App original abre
inicio con su servicio reciente y sin turno de prueba. Permiso ON comprobado en
Ajustes del sistema; el APK original no incluye el plugin LocalNotifications del
build temporal. Tablet devuelta al launcher, ajustes de pantalla conservados.
Proceso8790 con mismo PID y reverse8790 intactos;8792/8793 cerrados, reverse8792 y
forward9226 retirados, control/configuración temporal eliminados. Se conservaron
los cambios previos del worktree y evidencia privada; sin commits, despliegues,
migraciones remotas ni activación de producción. Tooling API15/15 y diff-check OK.

### Comprobación pendiente resuelta — Android, 2026-10-22

Nueva autorización específica: solo tablet del propietario, mínimo escenario
reproducible de prórrogas, sin producción y restaurando el estado de ese día.
Una ejecución con máximo8 intentos: cuatro acercamientos, tres prórrogas y una
llamada. Todos los eventos se provocaron por el dominio y sus temporizadores
reales; no se insertaron avisos ni se reconstruyó artificialmente su historial.

**PASS:**8 intentos,8 aceptaciones FCM,8 registros Android con `tag=notificationId`,
8 avisos visibles abiertos y resueltos con identidad propietaria. La llamada final
(`improved_ready`) se generó a las09:17:47.076 Europe/Madrid; FCM aceptó a
09:17:47.096, su registro de sistema se observó a09:17:50.355 y la apertura del
turno correcto se verificó a09:17:58.925. Después, la operación real de llegada
produjo `completed` y pantalla «Se ha confirmado tu llegada». Cero WhatsApp.

El observador comprobó antes de llamar que el launcher era la actividad visible
**y** que Capacitor devolvía `isActive=false`. Esperó el registro de Android del
ID exacto antes de abrir el panel. No hubo callbacks de recepción foreground ni
reenvíos. Este resultado cierra la cobertura pendiente; **no demuestra la causa**
de la falta de observación del21oct ni promete entrega garantizada.

Restauración comprobada contra backups **nuevos**: APK original SHA256 idéntico,
54 archivos privados idénticos antes de relanzar, vault idéntico, permisoON,
launcher y ajustes de pantalla conservados. La app original arranca pero muestra
«No se pueden actualizar los datos»: su API8790 ya estaba apagada al inicio
de esta ejecución y se dejó apagada; no se acredita carga del inicio con datos. Sin recompilar
ni cambiar assets/código del producto: se reutilizó el APK local ya verificado.
API/control8792/8793 apagados, reverse8792/forward9226 retirados; reverse8790
preexistente conservado (hoy no había proceso escuchando8790). Configuración
privada temporal retirada. Sin commits, despliegues ni migraciones remotas.

Evidencia privada, ignorada por Git:
`reports/android-device/push-final-call-20261022/`: `recheck-final.json`,
`final-call-background.json`, `notice-8-called-system.json`, panel/captura de
llegada, `restoration.json` y backups. No publicar los archivos de datos privados.
Límite8 de esta autorización separado del máximo27 de la sesión anterior.
Android13+, iPhone/ciclo completo y distribución remota permanecen fuera de alcance.

### iOS — llamada única y apertura de aviso antiguo — 2026-10-22

Autorización limitada al iPhone 14 Pro Max del usuario (iOS27.0.1), sin producción
y con restauración. **Validación parcial, no ciclo completo iOS.**

- Primera ejecución: un acercamiento aceptado por FCM mientras la app se observaba
  en primer plano; sin recepción visible ni apertura acreditadas. Se cerró y restauró.
- Nueva ejecución autorizada: un único envío real de llamada `ready`, con
  `passcodeRequired=true` antes de llamar. FCM aceptó y una captura física mostró
  No Queue en la pantalla bloqueada; el sistema ocultaba la previsualización.
- Llamada generada a las10:37:26.800CEST; apertura autenticada del mismo aviso a
  las10:49:21.773CEST, con una resolución y siete consultas posteriores del turno.
  El usuario confirmó recepción y apertura, pero no llegada. La UI y la base
  coincidieron en `expired`: el plazo de dos minutos había terminado. Esto
  acredita que abrir una llamada antigua recupera el estado vigente.
- Un intento real en esta segunda ejecución, sin reenvíos ni aviso de expiración.
  Los eventos intermedios generados durante la espera del operador fueron
  rechazados por el guard; sus intentos internos de outbox no son envíos FCM.
  Dos intentos reales entre ambas ejecuciones; cero WhatsApp y ningún otro receptor.
- Guard desarmado tras la única llamada; API conservada solo hasta comprobar la
  apertura. Al terminar: app original firmada reinstalada, vault NoQueue restaurado
  byte a byte y contenedor completo de708archivos idéntico por SHA256; ninguna
  notificación ajena eliminada. API8788/control8789/inspector9227 apagados y
  configuración temporal retirada. Android y producción sin cambios.

El build original usa live reload HTTPS5173 y gate FCM desactivado; ese servidor
ya estaba apagado y no se reactivó. No restaurar una copia local antigua distinta
del bundle instalado: se verificó el respaldo real mediante firma y hashes.
El vault Keychain necesita respaldo separado del contenedor. Para restaurar los
datos, copiar el **contenedor completo en una sola operación** y verificar una
lectura posterior: las copias sucesivas por carpeta con eliminación de contenido
no conservaron el conjunto; el respaldo íntegro permitió recuperarlo.

Pendientes: llegada confirmada, ciclo completo iOS (prórrogas, mejoras, cesión,
desenlaces y permisos), apertura con proceso terminado y fase remota/TestFlight.
Evidencia privada ignorada por Git:
`reports/ios-device/push-lifecycle-session-20261022/call-recheck/`.

### iOS — llamada y llegada confirmada — 2026-10-22

Nueva autorización: un único aviso al mismo iPhone, con restauración.
**PASS del recorrido acotado llamada → apertura → confirmación del personal →
actualización del iPhone**, no del ciclo completo de seguimiento iOS.

- Turno sintético EVQX6S. Bloqueo comprobado antes de llamar. Un envío real
  `improved_ready` generado11:54:29.016CEST y aceptado por FCM; apertura autenticada
  del mismo aviso11:54:41.739CEST. La captura posterior muestra el turno llamado
  correcto: el usuario ya había abierto la notificación cuando se tomó.
- **La llegada la confirma el personal, no el cliente.** La pantalla indica
  «El personal confirmará tu llegada» y no ofrece «Ya he llegado». Se corrigió
  expresamente la instrucción inicial equivocada; no se simuló una pulsación
  inexistente ni se atribuyó al usuario la acción del personal.
- Se ejecutó `staffCommand(... action: 'complete')` mediante el control local
  del harness: estado `completed`, versión2, a las11:57. El iPhone se actualizó
  a «Se ha confirmado tu llegada», con la hora correspondiente. No se modificó
  directamente ningún evento, estado del turno ni fila de outbox para lograrlo.
- Plazo de llegada10min **solo en la fixture efímera**, para absorber la latencia
  de coordinación; copia privada del runner, sin cambios en el producto ni en
  el runner original. Un intento real total, sin push adicional por llegada,
  cero WhatsApp y ningún otro receptor.
- Incidencia del tooling: desarmar anticipadamente también impide el control
  `complete`. Para esta ejecución se recuperó exclusivamente ese control en la
  base efímera identificada, manteniendo presupuesto1 ya consumido, OAuth0 y
  registro de destinatarios vacío. Las tres barreras de envío siguieron cerradas;
  tras la operación real se desarmó de nuevo. No ampliar presupuestos ni borrar
  el historial de intentos para resolver este problema en pruebas futuras.
- Restauración verificada: app original firmada, vault idéntico y708archivos del
  contenedor idénticos por SHA256; runner original sin cambios, ninguna
  notificación ajena eliminada, servicios/API/control/inspector retirados.
  Producción y Android intactos. Evidencia privada en
  `reports/ios-device/push-lifecycle-session-20261022/arrival-recheck/`.

Queda resuelta la comprobación de llegada pendiente del ejercicio anterior.
Prórrogas, mejoras en espera, cesión, otros desenlaces/permisos y distribución
remota continúan pendientes en iOS.

### Arco del plazo de llegada — corrección local — 2026-10-22

Tras observar el cronómetro rojo sin arco, se identificó que la fórmula anterior
dividía el tiempo de llegada restante por la espera inicial: con espera inicial
de 4 minutos y plazo de llegada de 10 minutos, el resultado quedaba limitado a
cero. No era un fallo de dibujo de iOS.

Por elección explícita del usuario, durante `called` el arco rojo **se llena de
0% a 100% con el tiempo transcurrido del plazo de llegada**, independientemente
de la estimación inicial. En el instante de llamada empieza vacío; a los
16 segundos de un plazo de 10 minutos ya representa 16/600. Al vencer se completa,
sin cambiar por sí solo el estado del turno. Espera y acercamiento mantienen sus
reglas anteriores; la llegada confirmada conserva el círculo verde completo.

Regresión automatizada: 783 pruebas web, comprobaciones de tipos web/E2E y lint
de los archivos afectados satisfactorios; escenario de navegador en Chromium y
WebKit satisfactorio, con reloj detenido y avance controlado. Se cubren ES/EN,
progreso creciente, límites, fechas inválidas y una nueva llamada. Evidencia
privada en `reports/ios-device/arrival-arc-fix-20261022/browser-fixed-clock/`.
Se restauró el build web previo después de la prueba. **Cero nuevos envíos,
sin producción ni instalación de esta corrección en el iPhone**: la validación
de la corrección en dispositivo físico sigue siendo una comprobación distinta.

### Android físico — arco de llegada sin notificaciones — 2026-10-22

**PASS** en la tablet autorizada Samsung SM-T500, Android 12 y WebView
155.0.8059.43. Instalación encima, sin borrar datos, de APK Debug corregida con
API exclusivamente local `https://127.0.0.1:8790` y push desactivado.

- Se ejercitó el código real instalado, dentro de Capacitor/WebView, con
  respuestas API sintéticas interceptadas por CDP. No se arrancó backend ni se
  generó un evento de llamada real; no se enviaron notificaciones.
- Caso original: espera inicial de 4 minutos y llegada de 10. A 9:43 restantes
  se ve arco rojo (~3%); tras observar otros 15 segundos reales crece a ~6%.
- Nuevo plazo sintético de 2 minutos y espera inicial de 1: observado completo
  con reloj real, **sin acelerar ni reemplazar el reloj**, con capturas al
  inicio, ~25%, ~50%, ~75% y 100%/0:00. Progreso creciente y SVG comprobados.
  Se atendieron 28 lecturas del turno y 28 de propiedad con datos simulados;
  ninguna petición inesperada durante la prueba. Los destinos no autorizados
  estaban bloqueados. Esto valida el cronómetro, no un nuevo recorrido push.
- La APK corregida queda instalada y verificada por comparación binaria.
  Restaurados 54 archivos privados y vault idénticos al respaldo; restaurados
  124 archivos generados del workspace. Retirado el túnel de inspección9228;
  conservado el túnel8790 preexistente y su API detenida. Permisos y ajustes del
  dispositivo sin cambios; sin producción ni commits.

Evidencia privada: `reports/android-device/arrival-arc-20261022/`, incluidos
`result.json`, `restoration.json` y capturas físicas. La corrección permanece
pendiente de instalación/validación física específica en iOS.
