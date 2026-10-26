# Run the Capacitor shells locally

## Quick path

```bash
pnpm install --frozen-lockfile
pnpm mobile:sync
pnpm --filter @noqueue/mobile native:open:ios
# or
pnpm --filter @noqueue/mobile native:open:android
```

`mobile:sync` builds `apps/web/dist`, verifies `index.html`, copies that exact artifact and updates native plugin dependencies. Use `cap copy` only when plugin/native dependencies did not change.

## Platform commands

```bash
pnpm mobile:ios
pnpm mobile:android
```

Android builds require JDK 21. Verify the active JDK before running or opening Android:

```bash
export JAVA_HOME="$(brew --prefix openjdk@21)/libexec/openjdk.jdk/Contents/Home"
test "$("$JAVA_HOME/bin/java" -XshowSettings:properties -version 2>&1 | awk '/java.specification.version/ { print $3 }')" = "21"
(cd apps/mobile/android && ./gradlew --version)
```

The CI Android job repeats the Android-specific Capacitor sync, rejects tracked native-project drift, and compiles `assembleDebug` under Temurin 21. iOS sync/build verification remains a local macOS check because no macOS CI runner has been selected:

```bash
pnpm mobile:sync
xcodebuild \
  -project apps/mobile/ios/App/App.xcodeproj \
  -scheme App \
  -sdk iphonesimulator \
  -configuration Debug \
  CODE_SIGNING_ALLOWED=NO \
  build
```

The iOS bundle identifier is `com.noqueue-app.ios` (Apple team `6VYYNUZPSH`, LUMOSA).
Android retains `com.noqueueapp.android`. Do not change these identifiers to work around signing errors.

## Not yet configured

- APNs/FCM delivery validation (Firebase and APNs credentials are configured; push remains OFF).
- iOS Associated Domains and Android intent verification.
- Store signing, listings and release tracks.
- Production `VITE_API_URL`.

## iPhone físico: firma de desarrollo, sin publicar

Estado comprobado el 21/10/2026: iPhone 14 Pro Max con iOS27.0.1 conectado por
cable, emparejado y con Developer Mode ya habilitado. Xcode27.1 detecta el destino.
**Firma validada:** tras iniciar sesión y confirmar la creación, Xcode generó un
certificado Apple Development (clave privada en el llavero del Mac), registró el
iPhone y creó `iOS Team Provisioning Profile: com.noqueue-app.ios` en LUMOSA.
El perfil vence el **21/10/2027 11:56:35 UTC**. Debug compiló firmado y el auditor
verificó firma, equipo, bundle, APNs development, caducidad e inclusión del iPhone.
App instalada y abierta; pantalla de recuperación/error de red observada.
La sesión del portal en Chrome no sustituye la cuenta de Xcode.

Pendiente para smoke funcional: API local accesible desde el teléfono. El bundle
actual usa loopback; no se han probado altas/turnos ni persistencia física. La
cabecera de recuperación se solapa con la barra de estado: corregir safe area y
revalidar visualmente. Push/auto-init/swizzling/Analytics siguen OFF.

Procedimiento reproducible (pasos de firma completados en este Mac):

1. El usuario inicia sesión en **Xcode → Settings → Apple Accounts → Sign In**,
   incluyendo contraseña/2FA personalmente, y comprueba que aparece LUMOSA.
2. Reutilizar certificado Apple Development válido si existe; si no, autorizar su
   creación y el registro de este iPhone/perfil de desarrollo en LUMOSA. No revocar
   certificados de otros desarrolladores, cambiar al Personal Team ni crear firma
   de distribución. Acuerdos pendientes se remiten al titular, no se aceptan
   automáticamente.
3. El proyecto ya usa Automatic Signing, equipo `6VYYNUZPSH`, bundle correcto y
   entitlement APNs `development` para Debug. Mantener gates push OFF y usar solo
   **App / Debug**; LocalSmoke es un target exclusivo de simulador.
4. Compilar para el identificador obtenido con `xcrun devicectl list devices`.
   Con credenciales/perfil ya disponibles, no hacen falta flags de provisión:

   ```bash
   xcodebuild -project apps/mobile/ios/App/App.xcodeproj -scheme App \
     -configuration Debug -sdk iphoneos -destination "id=$DEVICE_UDID" \
     -derivedDataPath /tmp/noqueue-physical-ios \
     -clonedSourcePackagesDirPath /tmp/noqueue-mobile-spm \
     -disableAutomaticPackageResolution -skipPackageUpdates build
   ```

   `-allowProvisioningUpdates` y `-allowProvisioningDeviceRegistration` permiten
   cambios en Apple: usarlos únicamente después de autorizar esa provisión.
5. Antes de instalar, comprobar firma, equipo, entorno, caducidad y que el perfil
   incluye **este** dispositivo (sin imprimir su identificador en el resultado):

   ```bash
   node apps/mobile/scripts/check-ios-push.mjs \
     --app /tmp/noqueue-physical-ios/Build/Products/Debug-iphoneos/App.app \
     --environment development --device "$DEVICE_UDID"
   ```

6. Verificar también gates OFF y endpoint del bundle. El artefacto actual usa
   `https://127.0.0.1:8788`: **en el iPhone eso es el teléfono, no el Mac**. Permite
   como máximo un smoke de instalación/arranque, no alta/recuperación contra la API
   local. Para esos flujos preparar una API efímera aislada accesible desde el
   teléfono, HTTPS confiable y autorización de red local; no cambiar a producción
   como atajo, desactivar validación TLS ni exponer el Worker públicamente.
7. Instalar/abrir solo tras las comprobaciones; no desinstalar una app existente
   ni borrar Keychain. Esto no es distribución App Store/TestFlight ni valida push.

Auditoría de ajustes: `node apps/mobile/scripts/check-ios-push.mjs`.
Pruebas del auditor: `pnpm --filter @noqueue/mobile test`.
Guía oficial: [Ejecutar en dispositivos físicos](https://developer.apple.com/documentation/xcode/running-your-app-on-simulated-or-physical-devices).

## Android: toolchain y smoke local sin despliegue

Validado el 20/10/2026 en macOS Apple Silicon. Todo el circuito siguiente usa
una API efímera local, datos ficticios, WhatsApp OFF y tráfico saliente del Worker
bloqueado. **No usa staging, producción, credenciales reales ni `deploy`.**

### 1. Instalar herramientas (una vez)

```bash
HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_INSTALL_CLEANUP=1 brew install openjdk@21
HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_INSTALL_CLEANUP=1 brew install --cask android-commandlinetools
source apps/mobile/scripts/android-env.sh
sdkmanager --sdk_root="$ANDROID_HOME" --licenses
sdkmanager --sdk_root="$ANDROID_HOME" \
  'cmdline-tools;latest' 'platform-tools' 'platforms;android-36' \
  'build-tools;35.0.0' 'emulator' 'system-images;android-36;google_apis;arm64-v8a'
source apps/mobile/scripts/android-env.sh
```

Revisar/aceptar las licencias del SDK. `sdkmanager` sigue funcionando en las
herramientas instaladas, aunque avisa de su sustitución futura por `android sdk`.
El SDK queda en `~/Library/Android/sdk`. El helper no modifica `.zshrc`, Java del
sistema ni otros proyectos; permite sobrescribir `JAVA_HOME` y `ANDROID_HOME`.
Instalar `cmdline-tools;latest` **dentro del SDK** es importante: el `avdmanager`
de Homebrew deriva la raíz desde su binario y no encuentra las imágenes del SDK
personal. En Intel/Linux elegir la imagen `x86_64` y adaptar la instalación del JDK.

```bash
java -version
(cd apps/mobile/android && ./gradlew --version)
echo no | avdmanager create avd --name noqueue-api36 \
  --package 'system-images;android-36;google_apis;arm64-v8a' --device pixel_7
```

No recrear con `--force` un AVD que contenga datos que se quieran conservar.
Versiones verificadas: JDK 21.0.12.1, Gradle 8.14.3, AGP 8.13.0, compile/target
SDK 36, emulator 37.2.12, imagen Google APIs ARM64 API36 revisión7.

### 2. Preparar HTTPS local y APK Debug

Desde la raíz del repositorio:

```bash
source apps/mobile/scripts/android-env.sh
bash apps/mobile/scripts/local-tls.sh
VITE_API_URL=https://127.0.0.1:8788 pnpm --filter @noqueue/web build
pnpm --filter @noqueue/mobile exec cap sync android
(cd apps/mobile/android && ./gradlew assembleDebug --no-daemon \
  "-PnoqueueLocalTlsDir=$PWD/../../../reports/android-local/tls/res")
```

El certificado y clave se generan en `reports/android-local/tls` (ignorado por
Git), duran 30 días y **no se instalan en el llavero del Mac ni en el sistema Android**.
Si caducan, borrar solo esos dos archivos locales, regenerar y recompilar el APK.
Se confía únicamente en ese certificado para `127.0.0.1` en un source set Debug
activado explícitamente. No hay HTTP, `ignoreHTTPSErrors`, certificados de usuario,
`onReceivedSslError.proceed()` ni bypass de autenticación. Release con la propiedad
`noqueueLocalTlsDir` falla deliberadamente; sin ella no incluye manifest/CA local.

APK: `apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`.
**Este APK y los assets sincronizados apuntan a loopback: NO distribuirlos.**
Antes de una build destinada a otros entornos, reconstruir React con su origen
HTTPS y volver a sincronizar; no reutilizar este `dist` ni los assets locales.
No ejecutar `pnpm mobile:android` para este smoke: reconstruye React sin garantizar
el `VITE_API_URL` local y no activa la confianza TLS de este Debug.

### 3. Arrancar API y emulador

Terminal A, raíz del repo:

```bash
WRANGLER_LOG_PATH=/tmp/noqueue-wrangler-logs pnpm --filter @noqueue/api dev:mobile
```

El harness aplica todas las migraciones (incluida 0029) a almacenamiento efímero,
crea servicios de recepción, restaurante y piscina abiertos24h y escucha **solo**
`127.0.0.1:8788`. El restaurante se activa explícitamente mediante el registro
de admisión de su ventana; `queue.open=1` por sí solo no basta.
Imprime el ID público de recepción; `/__local/evidence` conserva `service` y
añade `services` con los tres IDs públicos, contadores y estados agregados por
tipo, sin identidades ni capabilities. El entrypoint de test nunca se referencia desde configuración de
despliegue. Cada reinicio crea una DB nueva: los turnos anteriores ya no existirán.

Terminal B:

```bash
source apps/mobile/scripts/android-env.sh
emulator -avd noqueue-api36 -no-audio -no-snapshot -gpu swiftshader -port 5554
# Añadir -no-window para ejecución headless como la validación automatizada.
```

Terminal C, tras completar el arranque (`sys.boot_completed` debe ser `1`):

```bash
source apps/mobile/scripts/android-env.sh
adb -s emulator-5554 wait-for-device
adb -s emulator-5554 shell getprop sys.boot_completed
adb -s emulator-5554 install -r apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk
adb -s emulator-5554 reverse tcp:8788 tcp:8788
pnpm --filter @noqueue/e2e test:android
```

### 4. Qué prueba el smoke

`tests/e2e/mobile/android-smoke.mjs` interactúa con el **WebView real del APK**
mediante CDP/Playwright, con Keystore nativo y Worker/D1/DO reales locales. No
simula `Capacitor.isNativePlatform` ni sustituye la API por respuestas prefabricadas.
Solo admite seriales `emulator-*`; reiniciar el harness antes de repetirlo.

- Identidad anónima inicial; formulario y POST sin teléfono/WhatsApp.
- Alta 201; intento ajeno de leer/cancelar 404 y sin identidad 401.
- Archivo cifrado en `no_backup`; recuperación después de `am force-stop`.
- Reemplazo del mismo APK con `adb install -r` conserva identidad y turno (no
  sustituye una prueba de migración entre versiones reales).
- Cancelación UI 200 y retirada de la lista activa.
- Respuesta perdida **después de commit real**: persiste intención, sobrevive al
  cierre y reintenta con la misma clave; respuesta 200 y ningún duplicado.
- Dos turnos cancelados y dos asociaciones; cero contactos, consentimientos y
  registros en outbox WhatsApp.
- Logs del proceso comprobado sin identidad/capability.
- Corrupción controlada del archivo de prueba: error visible sin regenerar
  identidad; restaura el archivo original en `finally` y comprueba recuperación.

Resultados y capturas: `reports/android-local/` (ignorados). El smoke no exporta
secretos, tokens ni URLs de turno en el informe. CDP requiere `noDefaults: true`
porque WebView no implementa `Browser.setDownloadBehavior`. Los logs del bridge
Capacitor están desactivados: su `methodData` incluiría los secretos del vault.

Para probar manualmente la entrada a un servicio, usar el inspector WebView Debug
para navegar a `https://localhost/q/<ID-impreso>?lang=es`. **No valida QR, discovery
ni Android App Links**, pendientes de su bloque; el smoke entra por esa misma ruta.

### 5. Cierre y límites

```bash
adb -s emulator-5554 reverse --remove tcp:8788
adb -s emulator-5554 emu kill
# Ctrl+C en la terminal de dev:mobile.
```

El emulador no sustituye hardware real, otras versiones Android, iOS, push,
firma release, distribución o smoke staging. Ningún comando anterior autoriza
un despliegue. No marcar estos gates como completados por haber compilado Debug.

Referencias oficiales: [entorno Capacitor](https://capacitorjs.com/docs/getting-started/environment-setup),
[sdkmanager](https://developer.android.com/tools/sdkmanager),
[seguridad de red Android](https://developer.android.com/privacy-and-security/security-config),
[WebView con Playwright](https://playwright.dev/docs/api/class-android).

## iOS: simulador, Keychain y smoke local sin despliegue

### Compatibilidad y transiciones

La app iOS requiere **iOS18.0 o superior**. El target de XCTest y el paquete
Capacitor propio `@noqueue/native-fcm` también fijan18.0. React Router View
Transitions se habilita en los WebViews que la implementen; Android conserva su
mínimo actual y continúa navegando sin animación si el WebView no ofrece la API.
No hay un segundo motor de animación ni se modifican rutas web/PWA.
El paquete Swift nativo fija Swift tools6.0 porque `.iOS(.v18)` requiere
PackageDescription6; `capacitor.config.ts` fija la misma versión para el paquete
SPM generado por Capacitor.

La validación de compatibilidad requiere ejecutar la misma prueba en **runtime
iOS18** (mínimo) y **runtime iOS27**. Un resultado de iOS27 no acredita el mínimo.
Comprueba `xcrun simctl list runtimes`; si falta iOS18, instálalo mediante
**Xcode → Settings → Platforms** y crea un simulador NoQueue dedicado compatible
con ese runtime. No borres ni reinicies otros simuladores para preparar el test.
Al crear otro simulador, instala también el certificado local de CA solo dentro
de ese dispositivo según el paso de preparación de abajo.

Tras elevar el deployment target, cuando `apps/web/dist` corresponda al build
local aprobado, regenera dependencias nativas con:

```bash
pnpm --filter @noqueue/mobile exec cap sync ios
```

El `Package.swift` dentro de `CapApp-SPM` es generado: **no lo edites a mano**.
La build instalada debe anunciar `MinimumOSVersion = 18.0`.

### Preparación

Validado con Xcode27.1/SDK27.1 y runtime iOS27.0, iPhone17 ARM64. Si `simctl` no
responde o informa incompatibilidad de CoreSimulator, completar la preparación
oficial de Xcode (`xcodebuild -runFirstLaunch`) y comprobar `xcrun simctl list runtimes`.
Puede requerir autorización del sistema; no borrar dispositivos del usuario para
resolver un servicio desactualizado. En esta máquina se actualizó1171.7→1174.9.2.

Crear **una vez** un simulador exclusivo (adaptar identificadores al inventario
real de `xcrun simctl list devicetypes` / `list runtimes`):

```bash
mkdir -p reports/ios-local
xcrun simctl create 'NoQueue iOS local' \
  com.apple.CoreSimulator.SimDeviceType.iPhone-17 \
  com.apple.CoreSimulator.SimRuntime.iOS-27-0 > reports/ios-local/simulator-id
```

Para repetir, reutilizar el ID guardado; no recrearlo ni sobrescribirlo. Todos los
comandos siguientes se ejecutan desde la raíz del repo:

```bash
ID=$(cat reports/ios-local/simulator-id)
xcrun simctl boot "$ID"  # omitir si ya está Booted
xcrun simctl bootstatus "$ID" -b
bash apps/mobile/scripts/local-tls.sh
xcrun simctl keychain "$ID" add-root-cert reports/android-local/tls/res/raw/noqueue_local_ca.pem
VITE_API_URL=https://127.0.0.1:8788 pnpm --filter @noqueue/web build
pnpm --filter @noqueue/mobile exec cap sync ios
```

Se reutiliza el certificado del harness Android, confiándolo solo dentro de este
simulador dedicado. No se añade confianza al llavero del Mac, no se desactiva ATS
ni se interceptan challenges TLS en producto. Si el certificado caduca, regenerarlo
según la sección Android y volver a importarlo. El simulador alcanza el loopback
del Mac directamente, sin `adb reverse`.

### Ejecutar la prueba

Terminal A (API efímera nueva; detener la instancia anterior si existe):

```bash
WRANGLER_LOG_PATH=/tmp/noqueue-wrangler-logs pnpm --filter @noqueue/api dev:mobile
```

Terminal B:

```bash
pnpm --filter @noqueue/mobile test:ios
```

El runner exige que el ID apunte al simulador arrancado de nombre exacto
`NoQueue iOS local` y que la DB del harness esté vacía. Alternativamente se puede
pasar `IOS_SIMULATOR_ID`. Reiniciar la API antes de repetir el smoke completo;
no hace falta borrar Keychain ni datos del simulador. El formulario usa el nombre
operativo ficticio «Prueba iOS local».

El runner compila el scheme **LocalSmoke** y ejecuta siete tests en invocaciones
separadas de `xcodebuild test-without-building`, terminando la app entre fases:

1. Alta desde el formulario en WKWebView, sin teléfono/WhatsApp;201. Leer el registro
   real con Security.framework, contrastarlo con el plugin y verificar
   `WhenUnlockedThisDeviceOnly` y ausencia de sincronización.
2. Recuperación del mismo turno/identidad después de un nuevo proceso (PID distinto),
   rechazo de otra instalación y cancelación UI200.
3. Otro arranque conserva identidad pero no vuelve a listar el turno cancelado.
4. Alta real201: el interceptor espera la respuesta del Worker y su cuerpo, pero
   lanza un error antes de entregarla a la UI. Reintenta desde el mismo formulario;
   el servidor responde200 con la misma clave/capability y se vuelve a perder la
   respuesta. D1 contiene solo un turno nuevo; la intención sigue en Keychain.
5. Nuevo proceso: misma identidad e intención, turno recuperado desde el servidor.
   Repetir el mismo formulario reutiliza la clave persistida, devuelve200 y la misma
   capability, no crea otro turno y elimina la intención pendiente. Cancelar por UI.
6. Corrupción controlada del **único registro de la app** mediante `SecItemUpdate`:
   JSON truncado, esquema inválido y bytes UTF8 inválidos. Recargar el documento
   WKWebView para eliminar la caché JS; verificar error visible, reintento sin
   peticiones autenticadas y bytes corruptos intactos (no regeneración silenciosa).
   Restaurar los bytes originales entre casos y comprobar recuperación de la UI.
7. Otro proceso confirma identidad original restaurada, ninguna intención pendiente
   y lista vacía. Resultado D1 final:2 turnos cancelados,2 asociaciones,0 contactos,
   consentimientos y outbox WhatsApp.

El backend y el bridge son reales; se usa `WKWebView.callAsyncJavaScript` para
operar los controles DOM. No se fabrican respuestas API ni se sustituye Keychain:
la inyección de pérdida ocurre **después del commit real**, en el límite fetch/UI;
no reproduce un corte de radio físico. Esto **no es
QA táctil/teclado/VoiceOver**. El checkpoint en Documents contiene solo hashes de
identidad/ruta/clave idempotente, PID e ID público de servicio; nunca secreto o capability. El target
`AppLocalTests` solo soporta simulador y no pertenece a las fuentes del producto.
No lanzar las siete pruebas juntas en Xcode: las fases de recuperación exigen
procesos distintos.

La prueba de corrupción conserva el original **solo en memoria**, sin volcar el
secreto a Documents/logs. `defer` lo restaura también ante throws/assertions; no
borrar el llavero del Mac ni usar `simctl keychain reset`. Una terminación forzada
por crash/SIGKILL durante esa fase no ejecuta `defer`: en ese caso la siguiente
prueba debe fallar cerrada; no borrar la identidad para obtener un falso positivo.
Usar otro simulador dedicado de pruebas y repetir con una API efímera nueva si se
necesita recuperar un entorno destruido. Esto no constituye recuperación automática
de una identidad corrupta en producción, ni valida bloqueo de Keychain físico.

Salida: `reports/ios-local/smoke-result.json`, y una carpeta `run-*` con logs y
`.xcresult` por fase. El runner confirma1 test realmente pasado por fase, no solo
el exit code de Xcode. Los logs brutos/resultados son evidencia privada ignorada
por Git; no publicarlos automáticamente. El resumen no contiene credenciales.

Para exportar las capturas de alta y recuperación (hay adicionales en fases4 y6):

```bash
RUN=$(node -p 'require("./reports/ios-local/smoke-result.json").run')
xcrun xcresulttool export attachments \
  --path "$RUN/test01AnonymousAdmissionAndKeychain.xcresult" \
  --output-path "$RUN/screenshots/admission"
xcrun xcresulttool export attachments \
  --path "$RUN/test02RecoveryAndCancellationAfterRelaunch.xcresult" \
  --output-path "$RUN/screenshots/recovery"
```

El build utiliza `/tmp/noqueue-mobile-ios` como DerivedData (sobrescribible con
`NOQUEUE_IOS_DERIVED_DATA`) y `/tmp/noqueue-mobile-spm` como caché SPM. La firma es
ad-hoc para simulador, no una firma de distribución. No requiere publicar nada.

### Transiciones nativas (iOS18 mínimo e iOS27)

La prueba comparte el mismo escenario UI entre WKWebView y Android WebView. Su
helper JavaScript y el XCTest están en `AppLocalTests` exclusivamente; no se
incluyen en `App.app`. Cada ejecución usa la API local fresca, navega por inicio,
búsqueda, filtros, establecimiento, formulario, volver, alta, recuperación y
overlays, y cancela los turnos creados. La grabación/capturas y el `.xcresult` se
guardan bajo `reports/ios-local/transitions/` (ignorado por Git); se registran
solo las fases y direcciones seguras de transición, nunca URL/capabilities.

Después de compilar/sincronizar los assets locales y añadir CA al simulador
seleccionado, ejecuta la misma prueba separadamente en los dos runtimes. Mantén
**Reduce Motion desactivado en el pase visual normal del simulador iOS dedicado**;
el segundo pase de XCTest simula `prefers-reduced-motion: reduce` solo dentro de
la vista de prueba y comprueba que navega sin animación. La prueba falla si iOS no
ofrece/instrumenta View Transitions o no se observan avance, retroceso y replace.

```bash
IOS_TRANSITIONS_SIMULATOR_ID="$IOS18_SIMULATOR_ID" IOS_TRANSITIONS_EXPECT_RUNTIME=18 \
  pnpm --filter @noqueue/mobile test:ios:transitions
IOS_TRANSITIONS_SIMULATOR_ID="$IOS27_SIMULATOR_ID" IOS_TRANSITIONS_EXPECT_RUNTIME=27 \
  pnpm --filter @noqueue/mobile test:ios:transitions
```

`IOS_TRANSITIONS_SIMULATOR_ID` debe apuntar a un simulador dedicado arrancado y
`IOS_TRANSITIONS_EXPECT_RUNTIME` verifica el runtime para evitar certificar iOS27
como mínimo. El script también inspecciona `MinimumOSVersion=18.0` del artefacto.
No ejecutarlo en paralelo con otras suites iOS que compartan simulador, DerivedData
o API.

Para Android, compila/instala el APK Debug con assets locales y arranca el AVD
dedicado `noqueue-api36` según la sección Android. Reinicia el harness para una DB
vacía; el runner registra nivel Android y versión Chromium/WebView, captura ambos
pases (normal, movimiento reducido y API deshabilitada solo en el test), y borra
solo su vídeo temporal remoto:

```bash
source apps/mobile/scripts/android-env.sh
pnpm --filter @noqueue/e2e test:android:transitions
```

La navegación sigue funcionando normalmente si el Android WebView no expone la
API; en ese caso el informe debe decir `apiSupported: false`, sin declarar que hubo
animación. Cada ejecución crea y cancela un turno de prueba; el pase de movimiento
reducido navega por enlaces reales sin crear un turno adicional. Push, contactos,
consentimientos y outbox permanecen vacíos. Reinicia `dev:mobile` antes de la otra plataforma;
no corras ambas suites al mismo tiempo.

### Resultado de transiciones — 21/10/2026

- **Implementación solo nativa**: loader `native-root` secuencial (propiedad →
  redirect → datos), seed de recursos y coordinador compartido cancelable (15s).
  Las pantallas públicas salientes permanecen inertes mientras se prepara el
  destino; un turno privado diferente se oculta inmediatamente al cambiar su
  propiedad. No se montan dos árboles para animar ni se añaden dependencias.
- Perfil de la validación inicial: slides forward/back de260ms y fade replace
  de180ms. Ajuste posterior por feedback en iPhone físico, servido por HMR:
  slides380ms, fade260ms, easing `cubic-bezier(0.25, 0.65, 0.2, 1)` y velo negro
  equivalente al28% en el snapshot de fondo (aparece al avanzar y se retira al
  volver). Usuario aprueba este perfil. Iteración posterior: entrada del turno
  `bottom-up` de420ms, opaca, con fondo inmóvil oscurecido al28%; conserva el
  replace del historial, sin convertir la pantalla en sheet ni permitir cierre.
  Usuario aprueba esta entrada vertical. Se retira la prueba de salida `top-down`:
  cronómetro y confirmación de abandono son estados de la misma ruta, por lo que
  se animaba la confirmación, no el cronómetro. Por petición del usuario se conserva
  la salida lateral `back` de380ms desde la confirmación hacia inicio, sin añadir
  animación al cambio de estado interno. Los
  vídeos de la matriz anterior corresponden al perfil inicial. Todo queda scoped
  al documento nativo; queries, idioma y polling no animan y web/PWA no cambia.
- **694 tests web y43 tests de scripts mobile pasan**; typechecks web/mobile/e2e
  y builds web/Android/Xcode pasan. ESLint:0errores,2warnings preexistentes.
- **iOS27 WKWebView: PASS** avance, retroceso, confirmación, recuperación, red lenta,
  sustitución rápida del destino y movimiento reducido. Los enlaces se entregan
  al `SceneDelegate` real mediante XCTest; no certifica asociación universal-link
  del dominio con el sistema operativo.
- **Android API36 / Android WebView133.0.6943.137: PASS** mismo flujo, `ACTION_VIEW`
  dirigido a la Activity, Back cierra scanner, Back con turno minimiza y resume;
  movimiento reducido y API ausente siguen navegando sin animaciones.
- **iOS18: pendiente de validación runtime**. Xcode no ofrece la descarga solicitada
  de iOS18.0/18.5 en este entorno. No sustituirla por la prueba iOS27. Todos los seis
  deployment targets, plugin propio y SPM requieren18; el binario inspeccionado
  declara `MinimumOSVersion=18.0`. Dos `sync` consecutivos conservan SPM idéntico.
- Capacitor usa `experimental.ios.spm.swiftToolsVersion: '6.0'` para regenerar `.v18`.
  El plugin propio conserva `swiftLanguageModes: [.v5]`; elevar el mínimo no implica
  migrarlo accidentalmente al chequeo estricto de concurrencia de Swift6.
- Evidencia local ignorada por Git: `reports/ios-local/transitions/result.json`,
  vídeos y `.xcresult`; `reports/android-local/transitions/result.json`, vídeos y
  capturas. Los informes de fases solo contienen intención y tiempos, sin URLs ni
  capabilities. Cada plataforma termina con1turno cancelado,1asociación y0contactos,
  consentimientos o notificaciones. No se ha desplegado ni publicado ninguna app.

### Actualización sobre la app instalada (sin desinstalar)

Con el mismo simulador dedicado arrancado y **otra instancia nueva** de la API
local (vacía al inicio):

```bash
pnpm --filter @noqueue/mobile test:ios:upgrade
```

No ejecutar en paralelo con `test:ios`: comparten simulador, DerivedData y API.
El runner usa overrides CLI de Xcode para construir **1.0.0 (1001)** y luego
**1.0.1 (1002)**. Son etiquetas ficticias de prueba; no modifica las versiones del
proyecto ni genera un release para stores. Ambas comparten código y esquema de
almacenamiento actual; no pretende validar una migración futura todavía inexistente.

1. Instalar1001 con `simctl install` en el simulador existente. XCTest comprueba
   `Bundle.main`: bundle ID, versión y build realmente ejecutados. Crear dos turnos
   activos desde UI: uno confirmado al cliente y otro confirmado en servidor con
   dos respuestas perdidas. Guardar en Keychain la intención pendiente; checkpoint
   en Documents solo con hashes, PID, ID público y etiquetas de build.
2. Terminar la app, construir1002 e instalarla **encima**, sin uninstall, borrado,
   reset de Keychain, nueva siembra de datos ni reinicio de la API. Verificar la
   versión instalada, checkpoint byte a byte en el contenedor vigente y DB
   sin cambios. En un nuevo proceso de1002, comparar hash de todos los bytes del
   registro Keychain (identidad, intención, clave y payload incluidos), atributos
   device-only/no-sync y ambos turnos originales recuperados. Abrir el turno ya
   confirmado y reenviar el formulario de la intención pendiente:200, misma clave
   y capability,2 turnos totales y pendiente eliminado solo después del éxito.
   Cancelar ambos turnos por UI para probar acceso operativo tras la actualización.
3. Otro arranque de1002 confirma identidad original, ninguna intención pendiente y
   ningún turno activo. D1 final:2 cancelados,2 asociaciones,0 contactos/consent/outbox.

Evidencia separada: `reports/ios-local/upgrade-result.json`, carpeta `run-*`, logs y
`.xcresult` de cada fase. Los archivos siguen siendo privados/ignorados por Git.
El resumen registra versiones instaladas y las comprobaciones de continuidad;
el cambio de ruta del contenedor es informativo (iOS puede reubicarlo al instalar).
Los tests contrastan además la versión del proceso para evitar probar por error el
bundle antiguo. No se extrae el secreto de Keychain al host ni se copia para restaurarlo.

**Límites:** actualización local de bundles Debug con firma ad-hoc en simulador,
no distribución TestFlight/App Store, no hardware físico ni cambio de Team ID,
access group o esquema del vault. Un cambio futuro de esos contratos necesita su
propia prueba de compatibilidad/migración. No cubre desinstalación o transferencia.

### Restaurantes y piscinas — mismo escenario en ambos simuladores

Ejecutar **secuencialmente**, con API efímera vacía nueva antes de cada plataforma.
No reiniciarla entre fases de una misma plataforma ni ejecutar suites en paralelo.
Reutilizar certificado/artefactos Debug locales y los dispositivos dedicados.

```bash
# iOS: con NoQueue iOS local arrancado y API nueva
pnpm --filter @noqueue/mobile test:ios:services
# Detener API anterior y arrancar otra nueva antes de Android.
source apps/mobile/scripts/android-env.sh
# Emulador noqueue-api36 arrancado, APK Debug local instalado
pnpm --filter @noqueue/e2e test:android:services
```

Ambos runners ejecutan el escenario de
`apps/mobile/ios/App/AppLocalTests/service-scenarios.js` sobre WebViews nativos,
no navegador con Capacitor simulado. En iOS es recurso del bundle de test separado,
**no recurso del target App**; Android lo lee desde el runner y lo ejecuta por CDP.
Cada fase termina/reabre el proceso de app y verifica identidad y turnos originales.

1. **Alta:** dos grupos restaurante de2 personas (Terraza y opción rápida) y dos
   turnos individuales piscina. UI/payload sin teléfono/WhatsApp,201 y campos
   operativos persistidos. Piscina sin selector de comensales/sala; grupo de2
   enviado directamente a API rechazado400. Cuatro intenciones confirmadas limpias.
2. **Restaurante tras relanzar:** recupera exactamente los cuatro turnos. Actualiza
   por UI el primer grupo2→3 y Terraza→Salón. También mueve el segundo al Salón:
   una preferencia «más rápida» no es sucesor compatible de una zona explícita
   inferida; se respetan las reglas de `compatibleSuccessor`, no se modifican.
   Cede posición por UI; ambas versiones avanzan y cambia el orden relativo.
   Repetir mismo comando/clave devuelve200 sin otra cesión. Una versión obsoleta
   devuelve409. Otro intento sin sucesor muestra error y no muta. Cancela ambos.
3. **Piscina tras relanzar:** conserva solo los dos turnos originales de piscina.
   No muestra edición y API rechaza `update`409/unsupported_service; permite cesión
   entre turnos individuales y cancelación. Mismas pruebas de replay, versión
   obsoleta, falta de sucesor y acceso ajeno404 a lectura/cancelación.
4. **Último arranque:** identidad original,0 pendientes y lista vacía. Por plataforma,
   D1:4 cancelados (2 restaurante+2 piscina),4 asociaciones,0 contactos/consent/outbox.

Informes: `reports/ios-local/services-result.json` y
`reports/android-local/services-result.json`; capturas y resultados privados en
sus carpetas. Checkpoints solo guardan hashes de identidad/tokens y PID; las
credenciales permanecen en los vaults nativos o en memoria de las pruebas.

No cubre gestión staff, llamada/servicio/expiración, conflictos realmente simultáneos,
pruebas de radio ni hardware. Tampoco valida push, QR/discovery o distribución.
Los replays negativos se envían a la API real; los cambios principales se operan
mediante DOM en la UI nativa, no mediante gestos táctiles o VoiceOver.

### Cierre y límites

```bash
xcrun simctl shutdown "$(cat reports/ios-local/simulator-id)"
# Ctrl+C en dev:mobile. No usar shutdown all ni keychain reset en otros dispositivos.
```

El simulador se conserva apagado para futuras pruebas, con sus datos ficticios y
certificado local. La actualización local tiene una prueba separada arriba;
no se ha probado reinstalación, transferencia entre dispositivos,
bloqueo/desbloqueo en hardware real ni notificaciones push. Los assets/App.app
actuales apuntan a loopback: reconstruir con la API del entorno autorizado antes
de generar cualquier artefacto distribuible. No usar el bundle de test como release.

Referencias: [XCTest](https://developer.apple.com/documentation/xctest),
[WKWebView](https://developer.apple.com/documentation/webkit/wkwebview),
[Keychain device-only](https://developer.apple.com/documentation/security/ksecattraccessiblewhenunlockedthisdeviceonly).

## Ciclo llamado / atendido / caducado en ambos simuladores

Usar simuladores dedicados, TLS local y assets loopback descritos arriba. Reiniciar
la API **entre plataformas**, nunca entre fases de una misma suite:

```bash
# Terminal 1: API nueva, D1 efímero y controles locales opt-in.
NOQUEUE_LOCAL_LIFECYCLE=1 WRANGLER_LOG_PATH=/tmp/noqueue-wrangler-logs pnpm --filter @noqueue/api dev:mobile
# Terminal 2: primero iOS; cerrar API y arrancarla de nuevo antes de Android.
pnpm --filter @noqueue/mobile test:ios:lifecycle
source apps/mobile/scripts/android-env.sh
pnpm --filter @noqueue/e2e test:android:lifecycle
```

Cada suite ejecuta cuatro procesos nativos distintos:

1. **Alta UI:** dos turnos restaurante y dos piscina, sin teléfono/WhatsApp.
2. **Llamado al reabrir:** el controlador Node llama a `QueueCoordinator.staffCommand`
   con actor local autorizado. Restaurante usa `call`; piscina `assign_next`
   (la llamada individual de servicios rápidos no es una acción permitida).
   Misma identidad, cuatro capabilities originales, fase `called`, plazo futuro,
   versión1, UI «¡Es tu turno!» y controles activos.
3. **Terminales al reabrir:** `complete` sobre el primero de cada servicio;
   para el segundo se esperan **dos minutos reales** de gracia del fixture y se
   ejecuta mantenimiento real mediante `refresh`. No se escribe estado/plazo
   por SQL ni se modifica el reloj. D1 termina en2 `completed` y2 `expired`.
   `completed` corresponde a fase cliente `arrived` y «Se ha confirmado tu llegada»;
   el estado legado `served` no se fuerza (la operación `release` está retirada).
4. **Otro reinicio:** mismos estados terminales, versiones2, identidad intacta,
   lista de activos vacía,0 intenciones pendientes. Los enlaces conocidos siguen
   dando200 al propietario,404 a otra instalación y401 sin identidad. Terminales
   sin acciones; cancelación explícita rechazada409. No reaparecen como activos.

**Recuperación, no historial:** la aplicación lista solo `waiting`/`called`.
Para verificar los enlaces terminales conocidos tras morir el proceso, XCTest
conserva exclusivamente esos enlaces en un registro de prueba Keychain separado
`com.noqueue.local-tests.lifecycle`, device-only/no-sync; se elimina al finalizar
la cuarta fase (se sustituye al empezar otra suite si una ejecución falló).
Android los conserva solo en RAM del runner. No se añade historial a producto,
no se escriben capabilities en checkpoints/informes ni se altera el vault real.

El control `/__local/lifecycle/*` existe exclusivamente en el servidor Node local,
requiere modo opt-in, POST y token aleatorio de archivo privado0600 en
`reports/android-local/lifecycle-control.json`. No recibe IDs arbitrarios ni SQL;
solo opera los cuatro turnos de fixtures locales. No se envía el token al WebView.
Al cerrar normalmente la API se elimina el archivo. No existe en el Worker de
producción; salidas HTTP externas siguen bloqueadas y WhatsApp apagado.

Informes `reports/{ios-local,android-local}/lifecycle-result.json`, `.xcresult`
iOS y capturas `lifecycle-*.png` Android, ignorados por Git. Escenario compartido
`lifecycle-scenarios.js` exclusivo del bundle de test. No equivale a UI staff,
push recibido en background, QA táctil/VoiceOver ni validación en hardware.

## Discovery nativo — inicio, búsqueda y establecimientos

El inicio nativo sin turno está en `/`; con turno activo se abre directamente
`/t/:token`. `/turns` solo es una redirección de compatibilidad. No hay dashboard.
Las secciones/suites históricas anteriores documentan el modelo previo y algunas
suponen varios turnos o selectores eliminados: no usarlas como gate del flujo
actual hasta convertirlas a escenarios secuenciales. Las suites vigentes para
esta corrección son discovery, capabilities, unitarias y API de turno único.

Para el recorrido nuevo, use la API efímera anterior, una DB vacía por plataforma,
los simuladores dedicados y el certificado local ya configurado. No use
credenciales de proveedores ni un Worker remoto. Desde la raíz:

```bash
VITE_API_URL=https://127.0.0.1:8788 VITE_PUBLIC_APP_ORIGIN=https://app.noqueue-app.com VITE_MOBILE_PUSH_ENABLED=false VITE_ANALYTICS_ENABLED=false \
  pnpm --filter @noqueue/web build
pnpm --filter @noqueue/mobile sync # necesario tras añadir geolocation; copy en cambios solo web
# API local (terminal separada; reiniciar antes de cada plataforma):
WRANGLER_LOG_PATH=/tmp/noqueue-wrangler-logs pnpm --filter @noqueue/api dev:mobile
```

Con el simulador iOS dedicado arrancado y su CA de pruebas instalada:

```bash
pnpm --filter @noqueue/mobile test:ios:discovery
```

Reinicie la API para que Android use una DB nueva. Con `noqueue-api36` arrancado:

```bash
source apps/mobile/scripts/android-env.sh
(cd apps/mobile/android && ./gradlew assembleDebug --offline --no-daemon \
  "-PnoqueueLocalTlsDir=$PWD/../../../reports/android-local/tls/res")
adb -s emulator-5554 install -r apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk
pnpm --filter @noqueue/e2e test:android:discovery
```

El escenario común `discovery-scenarios.js` vive solo en tests. Ejercita inicio,
texto, filtro, establecimiento, retorno a consulta, formulario anónimo, turno,
recuperación y cancelación; comprueba identidad estable, sin cookies/WhatsApp/push.
La API prepara direcciones y snapshots de directorio ficticios sin llamar a
Geoapify. Los informes `reports/{ios,android}-local/discovery-result.json` no
incluyen secretos ni capabilities; deben indicar `passed` para esta ejecución.
QR y ubicación mantienen los controles web. El runner iOS discovery incluye
ubicación simulada (`simctl privacy`/`location`) y capturas de seis estados. Android:

```bash
pnpm --filter @noqueue/e2e exec node mobile/android-capabilities.mjs
```

Este último usa cámara virtual y proveedor Android **de prueba** de ubicación de
red (coarseLocation), eliminado al terminar. `emu geo fix` por sí solo dio timeout
OS-PLUG-GLOC-0010 con permiso aproximado; no se amplían permisos a ubicación precisa
para hacer pasar el test. Comprueba stream/cierre, no lectura óptica de QR impreso.
Las pruebas DOM no sustituyen QA táctil/teclado/VoiceOver ni hardware.

La migración0031 falla si detecta duplicados antiguos: diagnosticar y resolver
explícitamente antes de migrar; nunca cancelar automáticamente. Todo este runbook
es local; no ejecutar migraciones remotas como parte de estas pruebas.

**Los assets sincronizados apuntan a loopback, no son publicables.** Recompilar y
sincronizar con el entorno autorizado antes de cualquier distribución futura.


#### Capturas web de referencia (solo loopback)

Con API efímera activa y las capturas/fixture sintético del runner Android ya
creados, abrir el servidor de referencia en una terminal y capturar en otra:

```bash
pnpm --filter @noqueue/e2e preview:parity
pnpm --filter @noqueue/e2e test:web:parity
```

Usa el build compartido en modo web, puerto4173 y proxy HTTPS local con CA de
pruebas. Sirve también el service worker real; no usar fallback HTML para sw.js.
No realiza altas web: el cronómetro se representa con fixture local de solo
lectura. Datos de catálogo equivalentes; no afirmar igualdad píxel a píxel entre
motores/SO ni orden de empates de DBs regeneradas. Capturas en
`reports/mobile-parity/`, no subir fixtures/logs de capabilities.

Android geolocation8.2 usa alias combinado en SDK<31: el manifest declara FINE
solo hasta SDK30 para compatibilidad. Android12+ permanece coarse-only. La matriz
Android24–30 todavía requiere ejecución; no se ha añadido tracking de fondo.

## iPhone físico: HTTPS LAN y live reload (21/10/2026)

### Decisión y límites

Capacitor documenta [`server.url` y `cap run --live-reload`](https://capacitorjs.com/docs/guides/live-reload);
Ionic automatiza ese mismo circuito con `ionic cap run ios -l --external`.
Aquí no necesitamos instalar Ionic: usamos Vite y Capacitor existentes, **HTTPS**
en una interfaz IPv4 privada concreta y un Worker efímero sin tráfico saliente.
No usar túneles públicos, direcciones de staging/producción, `secure:false`,
`NSAllowsArbitraryLoads` ni HTTP para la identidad anónima.

El iPhone debe alcanzar la IP del Mac en la misma LAN; el cable de instalación no
redirige `127.0.0.1` al Mac. `NOQUEUE_LOCAL_HOST` es opt-in y admite solo RFC1918;
por defecto `dev:mobile` sigue en loopback. El control lifecycle está prohibido en
LAN. Cada arranque del harness crea una base nueva: mantenerlo vivo durante
alta → cierre/reapertura → cancelación para verificar recuperación real.

### HTTPS de desarrollo

```bash
export NOQUEUE_LOCAL_HOST="$(ipconfig getifaddr en0)" # confirmar interfaz Wi-Fi
node apps/mobile/scripts/physical-tls.mjs
NOQUEUE_LOCAL_HOST="$NOQUEUE_LOCAL_HOST" pnpm --filter @noqueue/api dev:mobile
```

Certificados en `reports/ios-device/tls`, ignorados por Git, claves 0600, CA y
servidor con validez de siete días. El generador no reemplaza una CA existente
silenciosamente; comprueba vigencia y SAN para la IP actual. Si cambia la IP o
caduca, renovar de forma explícita y retirar la confianza anterior del teléfono.

Con consentimiento del propietario, facilitar **solo** el certificado público:

```bash
node apps/mobile/scripts/serve-local-certificate.mjs
```

Este servidor HTTP privado únicamente entrega `/noqueue-local.cer` en el puerto
8089, devuelve404 para cualquier otro recurso y se cierra a los15min. No sirve
las claves ni un listado de archivos. El usuario descarga ese certificado en
Safari, coteja su nombre/huella con el generador, instala el perfil en Ajustes y
activa su confianza en General → Información → Ajustes de confianza de certificados.
El código de desbloqueo y las confirmaciones de confianza los introduce el usuario.
Esto **no** es saltarse un aviso TLS; nunca aceptar certificados ajenos ni desactivar
validación. Retirar perfil/confianza al terminar. Si aparece el permiso de red local
de NoQueue, permitirlo para este entorno autorizado.

### A. Bundle local (prueba representativa de instalación)

```bash
VITE_API_URL="https://$NOQUEUE_LOCAL_HOST:8788" \
VITE_PUBLIC_APP_ORIGIN=https://app.noqueue-app.com \
VITE_MOBILE_PUSH_ENABLED=false VITE_ANALYTICS_ENABLED=false \
pnpm --filter @noqueue/web build
pnpm --filter @noqueue/mobile exec env NOQUEUE_NATIVE_PLATFORM=ios cap sync ios
# Compilar Debug firmado, auditar e instalar como en la sección de firma.
```

La app carga HTML/JS empaquetados desde `capacitor://localhost`; solo la API vive
en el Mac. No modificar bundle ID, Keychain ni reinstalar borrando datos.

### B. Live reload / HMR (solo desarrollo iOS)

```bash
NOQUEUE_LOCAL_HOST="$NOQUEUE_LOCAL_HOST" \
pnpm --filter @noqueue/web exec node scripts/native-live.mjs
NOQUEUE_NATIVE_PLATFORM=ios NOQUEUE_LOCAL_DEVELOPMENT=1 \
NOQUEUE_LIVE_RELOAD_URL="https://$NOQUEUE_LOCAL_HOST:5173" \
pnpm --filter @noqueue/mobile exec cap copy ios
# Compilar/instalar Debug en el mismo teléfono, sin desinstalar.
```

Vite fija push/AnalyticsOFF y proxifica `/api` hacia el harness HTTPS validando la
CA explícita. Solo ese proxy local sustituye Origin por `capacitor://localhost`:
la autenticación por instalación permanece y una petición sin secreto devuelve401.
**No se amplía CORS del Worker desplegable.** La recarga afecta a JS/CSS; cambios
nativos/plugins requieren sync/rebuild. Una edición CSS visible permite comprobar
HMR sin volver a instalar; retirar la edición de prueba después.

`server.url` no existe por defecto, requiere doble opt-in y solo admite HTTPS de
IPv4 privada/puerto5173. No hay wildcard navigation ni cleartext. El build phase
`verify-ios-environment.sh` rechaza cualquier configuración no-Debug con server.url.
Antes de dejar el proyecto o preparar una release:

```bash
# Sin NOQUEUE_LIVE_RELOAD_URL ni NOQUEUE_LOCAL_DEVELOPMENT en este comando:
pnpm --filter @noqueue/mobile exec env -u NOQUEUE_LIVE_RELOAD_URL \
  -u NOQUEUE_LOCAL_DEVELOPMENT NOQUEUE_NATIVE_PLATFORM=ios cap copy ios
```

Cerrar Vite, API y servidor de certificado al terminar. La app instalada conserva
su configuración de build: si tiene live reload necesita el Mac; reinstalar encima
el bundle normal para salir de ese modo (sin borrar identidad).

### Safe area sin plugin adicional

La causa del header era la ausencia de `viewport-fit=cover`, pese a tener padding
con `env(safe-area-inset-top)`. Se configura el viewport **solo para runtime native**
antes de renderizar React, conservando zoom y viewport web. NativeShell usa top y
laterales `env()`; los footers/sheets compartidos ya contemplan el inset inferior.
[Ionic usa variables basadas en los insets CSS](https://github.com/ionic-team/ionic-framework/blob/main/core/src/css/core.scss).
El [plugin community safe-area](https://github.com/capacitor-community/safe-area)
explica que iOS admite `env()` y que su corrección principal es para WebViews Android
antiguos. No añadimos dependencia ni una altura fija de notch. Validar portrait,
landscape, formularios, teclado y sheets; no extrapolar una captura a toda la UI.

Además, el bootstrap marca el documento nativo y los campos usan un mínimo de16px
(incluidos diálogos portalled). Evita el autozoom de campos pequeños sin deshabilitar
el zoom accesible ni modificar los formularios web. La validación física de foco, escritura, cierre del teclado y envío confirmó
cabecera/escala correctas, sin zoom residual. No extrapolar a todos los campos ni
orientaciones: los tests DOM no sustituyen esta comprobación.

El21/10 se verificaron alta restaurante asistida, recuperación tras reinicio frío y
tras instalación de la variante live sobre el mismo bundle, y HMR CSS real sin
recompilar. El turno siguió siendo el mismo, con1 asociación móvil y cero contactos,
consentimientos o notificaciones. La cancelación física también quedó registrada (1cancelled/0activos) y el bundle
normal sin live reload volvió al inicio tras arrancar de nuevo. Ver checklist para
validaciones adicionales y retirada de la confianza temporal.

Una segunda alta física después de cancelar creó un nuevo turno, manteniendo el
primero cancelado y solo uno activo. Los contadores de contactos, consentimientos
y notificaciones permanecieron a cero.

### Política actual: solo portrait

El21/10 el usuario sustituyó el requisito de giro por orientación exclusivamente
vertical. Se configura nativamente, no con rotación CSS ni un plugin de permisos:
`UISupportedInterfaceOrientations` y su variante iPad contienen soloPortrait;
Android MainActivity declara `screenOrientation="portrait"`. `UIRequiresFullScreen`
solicita escena compatible en iPad; Android target36 usa el opt-out de restricciones
de tamaño. Ninguno garantiza controlar la orientación del display/ventana en todos
los modos de escritorio/tablet. Revisar al migrar target37 (Android elimina opt-out
>=600dp). Conservar el layout responsive para los modos que el SO puede imponer.

Para comprobarlo en iPhone, instalar el build encima (sin desinstalar), abrir la app
y girar físicamente a ambos lados con bloqueo del sistema desactivado: la escena
debe seguir vertical. No aceptar una captura vertical como única prueba si el
usuario no ha girado el dispositivo. La captura08-landscape corresponde al build
anterior y ya no acredita el comportamiento objetivo.

Bloqueo confirmado en el iPhone físico con giro a ambos lados (usuario asistido),
tras instalar encima el Debug firmado. Android Debug compila y su APK declara
portrait; el runtime del teléfono emulado API36 se validó después con el smoke
siguiente. iPad y pantallas grandes siguen pendientes. Se cerraron los
servidores locales después de confirmar2turnos cancelados/0activos y0avisos.
El propietario debe retirar el perfil/confianza temporal al dejar de usar este
entorno. Reiniciar el harness crea fixtures nuevos; no sirve para recuperar los
turnos de una sesión anterior cuya base efímera ya se haya cerrado.

### Smoke Android portrait y turno único

Después de construir el APK local y arrancar API efímera nueva/AVD según este
runbook (sin `NOQUEUE_LOCAL_HOST`, sin lifecycle, sin push):

```bash
source apps/mobile/scripts/android-env.sh
adb -s emulator-5554 install -r apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk
pnpm --filter @noqueue/e2e test:android:portrait
```

El runner solo admite el AVD `noqueue-api36`. Requiere DB vacía y no borra la
identidad. Usa un control positivo en Ajustes Android (gira90°) y después comprueba
rotación efectiva de WindowManager, preferencia solicitada y viewport nativo en
cada estado. Restaurante/piscina/recepción se prueban secuencialmente: alta desde
formulario, recuperación directa en un PID nuevo, identidad conservada, cancelación
por diálogo y regreso al inicio tras relanzar. No fuerza la ruta del turno para
hacer pasar recuperación; no devuelve secretos/capabilities en el informe.

Restauración de giro y retirada de puertos ADB en `finally`; finalizar también
API/emulador que se hayan iniciado para esta ejecución. Un fallo obliga a leer el
informe y a repetir con API efímera nueva, nunca limpiar Keystore para ocultarlo.
Salida: `reports/android-local/portrait/result.json` y capturas (ignoradas por Git).
El runner captura HTML del WebView, no el marco/statusbar del dispositivo; el
bloqueo nativo se acredita adicionalmente con WindowManager y control positivo.
Los runners históricos `test:android`/services aún tienen aserciones del listado
antiguo: no usarlos como evidencia de la navegación actual sin actualizarlos.

## Barra de estado Android blanca (2026-10-21)

Se usa **SystemBars incluido en `@capacitor/core` 8**, no un plugin propio ni una
segunda dependencia `@capacitor/status-bar`. El bootstrap Android fija
`SystemBarsStyle.Light` únicamente para `SystemBarType.StatusBar`: significa
iconos oscuros. No llama al plugin en iOS ni navegador.

Android anterior a15 usa el color blanco del tema y sin scrim de contraste. Para
edge-to-edge, una superficie CSS fija cubre exclusivamente el inset superior y
pinta separador1px `#E5E5E5`. Respeta `--safe-area-inset-top` de Capacitor y su
fallback `env`; no consume insets ni añade padding adicional. La superficie es
inaccesible/no interactiva y tiene snapshot propio para no deslizar/oscurecer la
barra durante transiciones. El tema blanco también cubre el fallback de WebView
antiguo donde Capacitor aplica el margen nativo.

Validado instalando encima con pushOFF en Samsung SM-T500 Android12/WebView154
y emulador Android16/API36/WebView133. El segundo cubre el fallback de WebView
anterior a140; no equivale a probar todas las combinaciones modernas. Capturas
`reports/android-device/status-{before,after,api36}.png` (ignoradas). CSS real
fondoRGB255 y bordeRGB229; la captura Samsung aplica un tono cálido también al
resto de pantalla, cuyos ajustes globales no se modificaron.

Comprobaciones de esta modificación:717testsweb, lint de bootstrap, buildweb
(TypeScript incluido), syncAndroid, assembleDebug y diffcheck correctos. Emulador
cerrado al terminar; tablet conserva el APK actualizado y pushOFF.

### Reabrir Android por USB sin push ni reinstalar

Para el APK físico que apunta a `https://127.0.0.1:8790`, iniciar **dev-mobile**
(no `dev-mobile-push-real`):

```bash
NOQUEUE_LOCAL_PORT=8790 NOQUEUE_LOCAL_HOST= NOQUEUE_LOCAL_LIFECYCLE=0 \
  pnpm --filter @noqueue/api dev:mobile
adb -s DISPOSITIVO_AUTORIZADO reverse tcp:8790 tcp:8790
```

`NOQUEUE_LOCAL_PORT` solo admite8788(default) o8790; host privado/loopback y TLS
siguen validados. Este harness fuerza push/FCMiOS/WhatsApp OFF y bloquea toda
salida de red; no carga `.dev.vars` ni credenciales proveedor. Mantener proceso
y cableUSB mientras se prueba; pulsar Reintentar o reabrir si la app quedó en
error de red. Buscar «local»: restaurante, recepción y piscina ficticios.
Cada arranque crea D1 efímera nueva; servicios recientes de una ejecución antigua
pueden no existir. No borrar identidad/vault para ocultar esa diferencia.
