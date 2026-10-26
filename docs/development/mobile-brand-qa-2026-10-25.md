# Branding mobile: acta de QA local — 25/10/2026

Estado: **refinamientos implementados; pruebas locales parciales y distribución pendientes**.
La ampliación 1005/1006 al final de este documento es el estado más reciente.
Sesión abierta por petición del usuario para nuevas pruebas. No uploads, despliegues,
producción, WhatsApp, desinstalaciones ni borrado de datos. El cambio preexistente
`apps/api/wrangler.jsonc` permanece intacto.

## Implementado

- Corregido recorte real del splash Android 12: lienzo transparente 288dp con logo
  completo 98×154dp dentro del círculo seguro 192dp, sin redibujar los 13 paths.
- Foreground adaptativo navy del master, separado del monochrome blanco; ambos
  34×54dp dentro del círculo seguro 66dp. Tests comprueban píxeles, colores y máscaras.
- 48 derivados deterministas regenerados. No cambios de interfaz web/PWA.
- AAB e IPA firmados **1.0 (1004)** exportados a `output/mobile/internal-staging-1004/`.
  El AAB 1003 queda supersedido por el defecto visual. No confundir el archive
  intermedio Development con el IPA exportado Apple Distribution.
- Verificación de artefactos reales: **auditValid=true, storeReady=false** únicamente
  por falta de contraste del certificado upload con Play Console. IPA: firma
  Distribution/APNs production, permisos, privacidad y payload staging verificados.
  Estado de cuentas/aceptación de consolas sigue sin confirmar; no decir «listo para subir».

## Verificado localmente

| Área | Evidencia y alcance |
|---|---|
| Dispositivos | Samsung SM-T500 Android12/API31 físico; iPhone14ProMax iOS27.0.1 físico; iPad Pro13 M5 iOS27 **simulador autorizado** |
| QR | Usuario confirmó lectura real y apertura de QA1011Piscina en ambos físicos; URL staging y QR decodificado exacto |
| Cámara | Solicitud contextual QR, rechazo y alternativa manual; conceder/revocar/recuperar. Sin audio. Cámara física quedó habilitada |
| Ubicación | Acción explícita, rechazo y búsqueda manual, concesión y revocación. Android aproximada; iPhone concedida en uso (no se acreditó aproximada). Android quedó denegada; iPhone restablecida a no determinada |
| Push Android | Deshabilitar en Ajustes no impide turno; CTA lleva a Ajustes, habilitar y volver elimina CTA. FCM real recibido en background en1004, canal queue-updates, importancia4, recurso ic_stat_noqueue; tap abre VUF4AK correcto |
| Push iPhone | Revocación en Ajustes mantiene turno y muestra CTA; con scroll se accede, abre Ajustes, habilitar y volver elimina CTA. Test13RecoverPushByScrolling PASS; permiso restaurado habilitado |
| Splash/icono Android | Defecto reproducido desde launcher Samsung, corregido y vídeo posterior muestra logo completo. Arranque frío y retorno en caliente, sin splash extra retenido. Recurso/launcher navy completo |
| Capturas | 12 capturas nativas sin retoque de UI: discovery, servicios, solicitud, turno. iPhone1290×2796; iPad2064×2752; tabletAndroid1200×2000. Nombres/turnos sintéticos, sin vault/recovery URLs |
| Regresión | 69 tests mobile y73 web focalizados PASS; typechecks mobile/web y diff-check PASS. Generación determinista y safe-area/color checks PASS |

Las capturas son Debug1003 salvo turno final iPad Debug1004. La interfaz web no
cambió entre ambos; los assets nativos Android sí. El pack no constituye evidencia
de instalación de un AAB/IPA descargado de Store. La captura final iPad refleja
push rechazado con CTA opcional, no una recepción APNs ficticia. La tablet Android
no se presenta como teléfono Android; el iPad no se presenta como físico.

## Evidencia y límites del instrumental

- `reports/mobile-brand-qa/2026-10-25/`: resultados privados de ADB/XCTest, vídeos,
  capturas, fuentes temporales del runner y logs. No commitear ni publicar.
- `output/mobile/store-screenshots-2026-10-25/`: 12 PNG originales, manifest de
  dimensiones/origen/build/hash y README. Revisar selección comercial y campos
  vigentes de cada Store antes de upload; no reemplazarla por screenshots del splash.
- El usuario autorizó captura local privada del panel Android. Contiene avisos
  ajenos: **excluida del pack Store y de la documentación pública**.
- Tap de XCUITest sobre el centro de la fila de un switch iOS no lo cambia; se
  corrigió el gesto y se comprobó el valor. El CTA push requiere scroll cuando la
  espera prolongada aumenta el contenido. Fallos instrumentales iniciales no son
  fallos funcionales de la app. El iPad necesitó esperar a reconciliación del permiso.
- Una primera suite leyó fuentes temporales del runner; se repitió tras restaurarlas
  byte a byte:69/69. Una invocación web omitió jsdom; la correcta dio73/73.
- Runner separado de la app. El proyecto y LocalSmokeTests.swift quedaron
  restaurados byte a byte; los artefactos finales no contienen XCTest.

## Pendiente (no acreditado por estas pruebas)

- Android13+ físico: POST_NOTIFICATIONS runtime y apariencia temática real.
  Monochrome y máscaras solo acreditados por análisis de píxeles/recursos.
- iPad físico. Capturas y layout actuales son simulados.
- Splash iPhone desde launcher: la grabación de lanzamiento automatizado no
  acredita de forma concluyente el logo. Validación manual pendiente; no se
  desinstaló ni vació caché para forzarla. iOS assets/storyboard empaquetados auditados.
- Matriz visual completa claro/oscuro, máscaras/launchers alternativos y splash
  iPad no se declara terminada.
- Primera solicitud push iPhone rechazada desde estado nunca solicitado no se
  probó en físico; sí revocación y recuperación. No se borraron datos para forzarla.
- Vinculación upload key/Play, estado cuentas y aceptación de versiones.
- Upload, procesamiento, instalación/actualización Store; TestFlight APNs production
  y apertura desde proceso terminado requieren fase posterior autorizada.
- No se repitió matriz funcional completa ni offline; se reutiliza evidencia previa
  solo para su alcance original.

## Limpieza y continuidad

Cancelados exclusivamente nuestros turnos: S2C3RN, WD3T8H, HLD486, VGVYWV y VUF4AK.
QA1011Piscina quedó sin turnos y, usando «Cerrar lista», en **Lista pausada**
(switch Reanudar lista=0), sin nuevas inscripciones. No se cambió el horario del
servicio ni otras listas. La sesión/chat sigue abierta para pruebas adicionales.

Base Git: `93ed6b20adf565de57217abe558c2e0f3821a2d8` más cambios sin commit.
Node22.23.0, pnpm10.23.0, Sharp0.35.4, Xcode27.1(27A9275), Gradle8.14.3,
Android build-tools35.0.0, bundletool1.18.1. Hashes en la carpeta de entrega1004.


## Ampliación: refinamientos solicitados — builds 1005/1006

### Implementado

- Spinners shadcn pequeños a la izquierda del label en estados de envío/guardado,
  incluyendo sheets de turno y formularios compartidos. `aria-busy`, icono decorativo
  y bloqueo contra doble envío. Sin recolorear la interfaz ni desplegar la web.
- Volver desde inscripción/final de turno lleva a `/?lang=...`; `/v/:venueId`
  redirige al inicio, manteniendo `PublicVenue` en código como `@deprecated`.
- Back Android desde flujo público va al inicio aunque `canGoBack=false`; solo
  minimiza con turno activo o estando ya en inicio. No se cambia el vault.
- Plugin oficial `@capacitor/splash-screen@8.0.2` fijado en mobile/web. Configuración
  `launchAutoHide:false`, `showSpinner:false`, fondo `#E1E1E0`. `hide()` tras commit
  de ruta preparada o error recuperable; fade150ms, sin tiempo mínimo ni `show()`
  al volver de background. Watchdog JS20s ofrece recarga manual si el router queda
  pendiente. No sustituye una garantía nativa ante fallo anterior a ejecutar JS.
- iOS reutiliza storyboard original, logo32% del ancho. Android12 mantiene la
  composición/icono restringido por el sistema; no se fuerza un splash fullscreen.
- QR `object-cover` + fondo negro: rellena el marco sin bandas grises. Conservados
  ZXing, cámara trasera preferida, `audio:false`, limpieza y búsqueda alternativa;
  no se añade Capawesome ni se amplían permisos.
- Auditoría iconos: AppIcon universal de NoQueue correcto en fuente y IPA1004,
  CFBundleIcons iPhone/iPad y Assets.car correctos. En el iPhone solo se encontró
  `com.noqueue-app.ios`, no una segunda NoQueue. El aviso antiguo con icono Capacitor
  no prueba un asset incorrecto en el build actual: origen/caché pendiente de
  reproducir con notificación nueva. Android mantiene `ic_stat_noqueue`/queue-updates.
- AAB/IPA finales1006 firmados, archive y checksums en `output/mobile/internal-staging-1006/`.
  Configuración SplashScreen y payload staging comprobados **dentro de ambos binarios**.
  Auditoría real válida; storeReady=false por asociación upload certificate/Play
  pendiente (también sigue pendiente confirmar estado de las cuentas).

### Verificado localmente

| Prueba | Resultado/evidencia |
|---|---|
| Regresión final | 415 tests web focalizados y69 mobile PASS; tipos mobile/web, ESLint focal y diff-check |
| Splash Android12 físico | Vídeo1005 desde launcher: retiene logo completo y pasa directamente a discovery sin blanco+spinner |
| Splash iPhone físico | Vídeo1005: storyboard con proporción/color de referencia y fade a discovery; sin spinner intermedio |
| Regreso inscripción | Android1005 físico, iPhone1005 físico XCTest v3 y iPad1005 simulado XCTest v2 PASS |
| Back sin historial | Android1006 físico: COLD launch con intent explícito al servicio; KEYCODE_BACK vuelve a discovery, no minimiza |
| Arranque caliente | Android1005 e iPhone1005/iPad1005: regreso a discovery, sin reactivar splash |
| Instalación final | Android/iPhone físicos actualizados a Debug1006 in-place, sin desinstalar ni borrar datos |
| Staging | Solo QA1011Piscina reabierta temporalmente; quedó pausada y con0 turnos. No se crearon turnos nuevos en esta ronda |

Evidencia privada en `reports/mobile-brand-qa/2026-10-25/refinements1005/` y
`refinements1006/`. La prueba iPhone v1 falló por caracteres perdidos al inyectar
texto masivo; v2 fue desviada por un banner de otra app sobre el header; v3 PASS.
Ese vídeo v2 contiene contenido ajeno accidental: no publicar ni usar como material
Store. No se inspeccionó más esa app y se restauró NoQueue en primer plano.
El tecleo rápido merece una regresión específica: no afirmar resuelto por teclear
más despacio en el runner. El cambio de app en v2 no fue un error del enlace Volver.

### Pendiente local (no dar por verificado)

- ~~Inspección física del nuevo encuadre de cámara~~: completada en la ampliación
  de cámara1006 descrita a continuación.
- Nueva push iPhone con build actual para contrastar el icono observado; no se ha
  probado que el aviso antiguo fuera caché ni se ha reiniciado/borrado la app.
- Inspección visual física de estados busy en sheets: cubiertos por tests, no por
  captura de cada operación. Capturas Store anteriores siguen identificadas por
  sus builds1003/1004; no renombrarlas como1006 ni inventar turno activo nuevo.
- Android13+ y iPad físicos, matriz de apariencias completa; UI recovery ante fallo
  previo al arranque de JavaScript no validado físicamente.

### Pendiente tras distribución autorizada

Sin cambios: upload, procesamiento, instalación/update Store, TestFlight/APNs
production y apertura desde proceso terminado. **No se ha subido ningún build**.
La sesión sigue abierta para las siguientes pruebas del usuario.


## Ampliación cámara1006 — superficie neutra autorizada

- Usuario confirmó Android e iPhone apuntando a superficie neutra antes de capturar.
- Samsung SM-T500 Android12 físico: el vídeo cubre todo el marco cuadrado, sin
  bandas grises laterales. Dos capturas locales y retorno a discovery con Volver;
  indicador de cámara ausente tras cerrar.
- iPhone14ProMax físico: XCTest `test18NeutralCameraFraming` PASS (1/1), vídeo
  rellenando el marco completo, sin bandas laterales ni error de acceso. Dos
  capturas y cierre con Volver, regreso a discovery e indicador de cámara apagado.
- Evidencia privada: `reports/mobile-brand-qa/2026-10-25/refinements1006/camera/`.
  Se preservaron los permisos, datos y configuración de staging. La lista QA no se
  reabrió y no se crearon turnos. No es una nueva prueba de decodificación QR: esa
  lectura física fue confirmada por el usuario anteriormente.
- Solo se recompiló el runner temporal1006; proyecto y fuentes de test restaurados
  byte a byte. No cambió código de app, AAB ni IPA; no hubo uploads.
- Quedan pendientes las capturas visuales de botones busy y una notificación nueva
  iPhone para contrastar su icono, además de los pendientes de distribución previos.


## Ampliación spinners y push nueva1006 — 25/10, 12:00–12:04

### Verificado físicamente

- **Android12 Samsung:** `QA Spinner Android`, turno `3CKEUT`, en QA1011Piscina.
  Pasar turno y Abandonar muestran spinner pequeño animado antes de `Guardando…`,
  conservan alineación y atenúan/deshabilitan controles mientras la petición está
  pendiente. Ambas operaciones concluyen correctamente. Vídeos reales, sin
  introducir latencia, mocks ni cambios en la app.
- **iPhone14ProMax:** `QA Icono iPhone`, turno `MKHVQX`. El sheet Abandonar presenta
  el mismo spinner a la izquierda de Guardando… y termina en «Ya no estás en la
  lista de espera». XCTest `test09CancelOwnQATurn`: **1/1 PASS**; vídeo y fotograma.
- Alcance visual: estos tres casos concretos sobre el componente compartido
  TurnSheet; no afirmar inspección física de cada variante party/space ni staff.
- Evidencia privada: `reports/mobile-brand-qa/2026-10-25/refinements1006/spinners/`.

### Push iPhone: recepción PASS, icono FAIL

- App1006 en segundo plano. Staff asignó exclusivamente `MKHVQX` desde staging.
  `test19FreshPushIcon` **1/1 PASS** confirma llegada de una notificación nueva;
  su captura se limitó al elemento nativo `NotificationShortLookView` de QA1011Piscina,
  sin abrir el centro de notificaciones ni capturar avisos ajenos.
- **La inspección visual muestra todavía el icono azul de Capacitor.** El PASS del
  test automatizado no valida la marca. Queda reproducido el reporte del usuario;
  no puede atribuirse solo a un aviso antiguo.
- Paquete Debug1006 compilado: AppIcon60x60@2x decodificado muestra NoQueue, y
  Assets.car/CFBundleIcons apuntan a AppIcon. Solo una NoQueue instalada, bundle
  `com.noqueue-app.ios`, versión1.0/build1006 (+runner de tests independiente).
  Auditoría Luna/max compara icono Debug/archive byte idéntico; el azul coincide
  con el icono previo al branding. No payload icon/image ni extensión de notificación
  o API alternate-icon que lo reemplace.
- **Hipótesis, no causa confirmada:** caché de iconos del sistema tras actualización
  in-place. Apple reconoce este tipo de incidencia y propone reiniciar para renovar
  la caché: https://developer.apple.com/forums/thread/775787.
- Solicitado al usuario reiniciar y desbloquear iPhone, sin desinstalar/resetear,
  para repetir una sola push sintética. Hasta obtener evidencia nueva con NoQueue,
  mantener esta incidencia pendiente; no cambiar assets correctos a ciegas.
- Evidencia: `refinements1006/push-iphone/59D8D479-CEE2-4216-8315-CF3FD49FFC3C.png`
  (banner), `compiled-debug-icon.png` (icono real del paquete), manifest y test.log.
  Prueba Debug/staging: **no** es validación TestFlight/APNs production.

### Limpieza y límites

- Los dos turnos sintéticos fueron cancelados desde sus apps. QA1011Piscina queda
  nuevamente **Lista pausada, 0 turnos**; prueba en
  `refinements1006/staging-paused-after-spinners-push.png`.
- No se actuó sobre otros servicios. La UI de QARecepción pasó de cerrado a abierto
  durante la prueba sin ninguna acción nuestra dirigida a ese servicio; no se
  alteró ese estado ajeno para intentar restaurarlo.
- Proyecto y fuente XCTest restaurados byte a byte; cambios preexistentes wrangler
  intactos. Ningún cambio de app, firma ni AAB/IPA. Sin uploads, producción ni WhatsApp.
- Chat abierto para continuar con el usuario. No declarar todas las pruebas cerradas:
  icono push iOS pendiente, además de los pendientes Store/dispositivos anteriores.


## Revalidación push iPhone tras reinicio — 25/10, 12:10–12:14

- Usuario confirmó «Reiniciado y desbloqueado». Se reutilizó Debug1006 instalado;
  no se compiló otra app, reinstaló, desinstaló, borró datos ni cambió assets.
- Solo QA1011Piscina reanudada; creado un turno `QA Icono iPhone`, `ZXM6LR`.
  Con la app en segundo plano se asignó una vez desde staff y se recibió una nueva
  push. **Icono visual PASS: logo NoQueue**, en apariencia oscura aplicada por iOS;
  ya no aparece el icono azul Capacitor. No se generó ninguna variante nueva.
- XCTest `test19FreshPushIcon`: **1/1 PASS**. Primer intento de automatización tras
  reinicio agotó plazo al habilitar UI testing antes de crear turno o interactuar;
  el único reintento completó la prueba. No se duplicaron inscripción ni llamada.
- Captura limitada al banner propio:
  `reports/mobile-brand-qa/2026-10-25/refinements1006/push-iphone-after-reboot/669C4E59-F6E5-4126-8FD3-739602BD631A.png`.
- El reinicio resolvió el caso observado; resultado compatible con caché de iOS
  reteniendo icono previo. No se inspeccionó internamente esa caché ni se garantiza
  el mismo resultado en todas las versiones/apariencias. No equivale a prueba
  TestFlight ni APNs production.
- Turno cancelado desde iPhone, `test09CancelOwnQATurn` **1/1 PASS**. Lista restaurada
  **pausada/0 turnos**, sin tocar otros servicios. Evidencia en la misma carpeta.
- AAB/IPA1006 conservan checksums anteriores; no cambios de código ni Stores.
  Chat permanece abierto para las siguientes pruebas del usuario.
