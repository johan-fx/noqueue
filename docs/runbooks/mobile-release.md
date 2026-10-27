# NoQueue mobile — runbook de release e Internal Testing

> Actualización 27/10: existe preparación local `production`; consultar [corte móvil de producción](production-mobile-cutover.md). Las restricciones y evidencias de staging siguientes son históricas, no una autorización de publicación.

Actualizado: 25/10/2026. Este runbook prepara los artefactos; **no autoriza ni ejecuta cargas a tiendas**.

## Alcance y reglas

- Esta fase produce builds nativos de distribución dirigidos exclusivamente a `https://staging.noqueue-app.com` para una futura pista interna. No cambiar producción, no publicar ni subir a TestFlight/Google Play sin autorización independiente.
- Los smoke tests físicos de staging del 25/10 son evidencia previa para el código/build probado; no certifican los nuevos brand assets ni un build de distribución.
- `PENDIENTE` significa que no hay resultado verificable para el artefacto actual. No cambiar un estado por inferencia, build iniciado, credencial presente o aceptación del proveedor.
- Mantener credenciales, perfiles, keystores, tokens, exports privados y datos de QA fuera de Git y de los logs. No borrar datos de instalaciones existentes.
- No crear una ruta que apunte a producción ni firmar con credenciales personales no aprobadas.

## Migración Android a Google Play — 25/10/2026

- Paquete vigente: `com.noqueueapp.android`; iOS sigue `com.noqueue-app.ios`.
- Firebase: mismo proyecto `nq-app-f3127` y remitente `54689871019`; nueva app
  Android `1:54689871019:android:862772299ec67a4cbf73ee`. El JSON cliente sigue
  ignorado por Git y no contiene claves privadas de servidor.
- La app Play creada por Alberto tiene ID `4972895022306821942`, en NQ-APP
  `6460888057339474774`. Usuario autoriza carga a **prueba interna**, solo
  `sosa.johan@gmail.com`; esta autorización no incluye producción ni pruebas abiertas.
- Preparación aislada: `pnpm mobile:release:prepare --profile internal-staging
  --build-number 1008 --platform android`. No sincroniza ni modifica iOS.
- Release falla si Firebase proyecto/sender/App ID no corresponden al nuevo
  paquete. El auditor comprueba también estos valores dentro del AAB compilado.
- Se conserva la upload key existente. Contrastar su SHA-256 con el certificado
  de **subida** que indique Play, no con la clave de **firma** gestionada por Google.
- El paquete nuevo no actualiza `com.noqueue.app`: los datos/turnos de la
  instalación anterior no migran automáticamente. No desinstalar ni borrar datos
  existentes como parte de esta migración.
- Evidencia de build1008 en `output/mobile/internal-staging-1008/`; estado de
  distribución en el último cierre del checklist y el reporte privado.

## Estado histórico de preparación inicial

| Entrega | Estado | Evidencia / siguiente condición |
| --- | --- | --- |
| Smoke staging en dispositivos físicos | Parcial: completado 25/10 | Acta `reports/staging-private/mobile-2026-10-25/verification.json` (evidencia privada/ignorada por Git); límites registrados abajo y en el checklist. |
| Revisión e incorporación de brand assets Figma | IMPLEMENTADO | Revisar y aceptar masters de [colores](https://www.figma.com/design/Y4yqqmDdJ0q1VAgA8EQsi6/NQFH---App?node-id=1854-32081&t=gcE4gjLfIltzS0Rb-4), [logo](https://www.figma.com/design/Y4yqqmDdJ0q1VAgA8EQsi6/NQFH---App?node-id=1854-32094&t=gcE4gjLfIltzS0Rb-4) y [splash](https://www.figma.com/design/Y4yqqmDdJ0q1VAgA8EQsi6/NQFH---App?node-id=1884-73608&t=gcE4gjLfIltzS0Rb-4); registrar exports/source. |
| Builds iOS/Android de distribución contra staging | FIRMADOS, AUDITADOS LOCALMENTE | Versión 1.0/build 1003, artefactos en `output/mobile/internal-staging-1003/`; no subidos. Ver cierre abajo. |
| Firma iOS Distribution/TestFlight | VERIFICADA EN IPA | Export local App Store Connect con Apple Distribution, APNs production y perfil Store del equipo esperado. No confirma procesamiento TestFlight. |
| Firma Android Play | FIRMA LOCAL VERIFICADA | Nueva upload key autorizada y custodiada fuera de Git. Vinculación con Play App Signing/Console pendiente. |
| Screenshots y ficha de tiendas | **PENDIENTE** | Hay evidencia local sintética reutilizable como referencia, no un pack actual de publicación; falta captura tras los nuevos assets y falta iPad. |
| Pista Internal Testing / TestFlight | **NO INICIADA** | No se ha subido ningún build. Requiere autorización posterior; el acceso a cuentas no se infiere de la firma local. |

## Base conocida y límites del smoke staging (25/10/2026)

El acta del smoke físico registra iPhone 14 Pro Max y Samsung SM-T500, bundles `com.noqueue-app.ios` y `com.noqueue.app`, Worker staging `e3c205d1-0415-4d89-8cc5-b8ca70f5941e` y commit `93ed6b20adf565de57217abe558c2e0f3821a2d8`. Discovery/búsqueda y alta se comprobaron en ambos; se confirmó la apertura del aviso llamado en ambos; además se probaron recuperación/llegada en iOS y caducidad en Android. Hubo 2 registros habilitados y 11 aceptaciones FCM sin error, pero aceptación no demuestra que cada aviso se viera.

Es un smoke test, no una regresión completa. QR/cámara, geolocalización, escenarios offline, matriz de permisos revocados y firma/distribución de Stores no se probaron en ese acta. `reports/staging-private/mobile-2026-10-25/verification.json` declara además cuatro cancelaciones y 0 excepciones/5xx en el tail observado; los registros `XT6WAK` y `27PH73` se conservaron. No usar datos ni capturas de esa prueba como material promocional.

## Inventario de capturas existentes

Las siguientes imágenes documentan pruebas automatizadas anteriores con datos sintéticos. Sirven de referencia para identificar pantallas, **no se deben copiar al pack final como si fueran nuevas capturas de distribución**: preceden a los brand assets pendientes y sus builds apuntaban al entorno local/loopback.

| Plataforma / fuente | Estados disponibles | Dimensiones de archivo | Proveniencia |
| --- | --- | --- | --- |
| Android nativo, `reports/android-local/parity-01-home.png` … `parity-06-turn.png` | Home, búsqueda, filtro, establecimiento, formulario y turno | 1082 × 2202 px | `emulator-5554`, Android API 36; ejecución local. El fixture `reports/android-local/parity-turn-fixture.json` muestra datos sintéticos (“Prueba discovery local”, “Establecimiento local”, servicio “Recepción Android local”); `discovery-result.json` confirma datos efímeros, sin push. |
| iOS nativo, `reports/ios-local/run-WGmjHG/attachments/` | `parity-01-home` … `parity-06-turn` y `discovery-home` (nombres lógicos en `manifest.json`) | 1206 × 2622 px | iOS Simulator “NoQueue iOS local”, test `LocalSmokeTests/test19NativeDiscoveryAndAdmission()`, API/DB local sintética; no iPhone físico ni staging. |
| Paridad web, `reports/mobile-parity/web-{ios,android}-01..06-*` | Referencias web de los mismos seis estados | iOS 1206 × 2622; Android 1082 × 2202 | Capturas de referencia web con viewports CSS indicados en checklist; no son app nativa ni sustituyen las anteriores. |
| iPad | Ninguna captura localizada en los sets anteriores | — | El target Xcode mantiene `TARGETED_DEVICE_FAMILY = 1,2`; si se mantiene soporte iPad, falta capturar y revisar sus pantallas reales. |

El pack nuevo depende de una sesión de captura posterior a aceptar e integrar la marca: regenerar pantallas desde la app nativa final contra staging o un backend de captura aislado con fixtures aprobados; confirmar que el endpoint es staging/sintético, que no contiene datos personales y conservar fecha, build, dispositivo/OS, dimensiones y origen de datos. Capturar los mismos estados en iPhone, iPad mientras siga soportado y Android. No reutilizar screenshots web, capturas físicas de turnos ni fixture local como si fueran screenshots finales.

Los targets de tienda, metadatos, grupos de tamaño y formatos deben verificarse en App Store Connect y Play Console antes de exportar/subir; no convertir las dimensiones de estos screenshots de QA en dimensiones de tienda por defecto.

## Flujo de preparación

1. **Aprobar fuentes de marca:** confirmar los masters de Figma, colores, composición del logo y reglas de splash; mantener fuente/vector, exports y licencia/proveniencia junto al registro de build. No aplanar capas Android si se necesitan iconos adaptativos/monocromos; no inventar una variante que no se aprobó.
2. **Cerrar inputs de distribución:** obtener mediante responsables autorizados la firma iOS Distribution/profiles y Android upload key/keystore/custodia, acceso organizacional y versiones/build numbers. Registrar ubicación segura y responsable; nunca guardar secretos en el repositorio. Si falta un input, el build de distribución queda PENDIENTE.
3. **Compilar con el pipeline release existente:** usar la configuración release nativa y endpoint de staging explícito. El build final no debe contener URLs loopback, credenciales ni artefactos de XCTest. Guardar commit, versiones, configuración no sensible, hashes y resultados de auditoría por plataforma.
4. **Auditar el artefacto antes de instalarlo:** verificar bundle IDs, firma/cadena y perfil/entitlements iOS, certificado/firma y permisos del manifest Android, endpoint de staging y configuración de push. Comprobar que las funciones que no conceden permisos siguen disponibles.
5. **Repetir QA del build brandado:** con autorización concreta para cada dispositivo, instalar como actualización sin borrar datos; probar apertura, discovery/búsqueda, detalle/servicio, solicitud, turno, push y apertura correcta. Registrar permisos concedidos/denegados/revocados y errores, sin inferir permisos del smoke previo. Cerrar cámara/streams y restaurar estado de dispositivos.
6. **Preparar evidencia de ficha:** ejecutar una sesión nueva de capturas sintéticas desde los builds aceptados; revisar legibilidad, recortes/orientación y que la UI representada exista. Añadir exports de tienda y textos solo tras confirmar tamaños/campos vigentes en las consolas.
7. **Detenerse antes de carga:** entregar IPA/AAB y evidencia con estado “listo para revisión interna”, no subir ni habilitar TestFlight/Google Play hasta autorización explícita posterior.

## Permisos y privacidad — gate en el build final

- **Push:** solicitar permiso en el contexto funcional aprobado; rechazo no bloquea búsqueda, alta ni consulta. Verificar el registro/token, estado del permiso y apertura propietaria del turno también cuando la app está en segundo plano/terminada. El smoke staging del 25/10 valida aviso llamado en ambos, no la matriz completa de ciclos, instalaciones o permisos revocados; push de TestFlight/producción requiere validar su configuración de distribución/APNs por separado.
- **Cámara:** solo para escanear QR, como opción; si se deniega, permitir búsqueda manual. Revisar propósito y texto de permiso nativo. No pedir micrófono/galería si no son necesarios.
- **Ubicación:** opt-in para búsqueda cercana y solo en uso; sin background. Android 12+ debe funcionar con aproximada; ofrecer búsqueda manual. Probar conceder, denegar y revocar en cada plataforma y comprobar que no se incluya ubicación en logs ni en capturas.
- **Auditoría:** comparar los permisos declarados en manifests/Info.plist/entitlements y etiquetas de privacidad con las capacidades efectivamente usadas y formularios Data Safety/App Privacy. El permiso y el código deben estar presentes solo si la función correspondiente está incluida y explicada.

## Criterios para declarar builds listos para Internal Testing

Por plataforma, cerrar todos los puntos antes de cambiar de `PENDIENTE` a `LISTO PARA REVISIÓN INTERNA`:

- Build de distribución reproducible y firmado con credenciales organizacionales correctas; bundle/package ID definitivo y versión/build number aceptados por la consola.
- Endpoint y push limitados a staging; el binario no incluye configuración local, claves privadas, pruebas/harness ni secretos.
- Firma, permisos, entitlements, privacidad, actualización sobre instalación existente y smoke de flujos core auditados en el artefacto exacto (no en Debug previo).
- Errores, bloqueos o gaps de cámara/ubicación/push resueltos o documentados con la función excluida de forma explícita.
- Evidencia sintética no personal, actual y por factor de forma soportado, dimensionada según los campos actuales de la Store.
- Versiones, hashes, commit, resultados y responsables registrados. El estado “listo” significa empaquetado, **no** enviado a tienda.

## Cierre por ejecución

Registrar una nueva entrada con fecha, commit, bundle/versiones, dispositivo/OS, endpoint, status por plataforma, hash de IPA/AAB, tipo de firma sin secretos, permisos revisados, pruebas/evidencias, warnings y límites. Mantener el estado `PENDIENTE` si no se completó un audit o no se pudo comprobar una firma. Registrar la carga a tienda en otra ejecución autorizada, no en esta fase.

## Ejecución de implementación — 25/10/2026, build 1003

- Master icono definitivo: Figma `1863:50820`, degradado explícitamente aprobado. Generador propio con Sharp 0.35.4 fijado, 48 outputs y fuentes SVG intactas. `@capacitor/assets` también reparado localmente ejecutando el lifecycle de Sharp 0.32.6; no se actualizaron peers ajenos.
- `mobile:release:prepare` reconstruyó/sincronizó staging y comprobó hashes del payload en ambas plataformas. Solo excluye los dos stubs Cordova conocidos tras validar que están vacíos.
- Android `bundleRelease` build1003 firmado con nueva upload key autorizada. iOS archive Release y export IPA App Store Connect completados; la exportación, no el archive intermedio con firma Development, es el binario de distribución.
- IPA auditado: Apple Distribution, equipo/bundle correctos, `get-task-allow=false`, APNs `production`, perfil Store no ad-hoc vigente, configuración FCM, payload staging y ausencia de Analytics. Cámara/ubicación ES/EN; sin propósito de red local en Release; 16 privacy manifests y sin XCTest en el primer archive de auditoría.
- AAB auditado con bundletool oficial1.18.1: firma válida, package/build/target36, permisos, FCM y hash web correctos. `verification.json`: **auditValid=true, storeReady=false** porque la nueva clave aún no se ha contrastado con una clave registrada en Play Console. No pasar su fingerprint local como si Play ya lo hubiera confirmado.
- Custodia Android autorizada: `~/.config/noqueue/signing/android-upload.p12`, `android-upload.env`, `android-upload-certificate.pem`; directorio0700 y archivos0600. Hacer copia de seguridad segura de key/config; no adjuntarlos a chats ni commits. La clave pública puede usarse posteriormente para configurar Play App Signing con autorización independiente.
- Xcode configuró la firma Distribution mediante `-allowProvisioningUpdates` tras autorización explícita posterior. ExportOptions usa `destination=export`: **ningún upload**.
- Verificación de firmas macOS necesita acceso normal al llavero/certificados; un sandbox restringido puede producir falsos fallos de codesign. El lector usa `codesign --xml` y procesa fechas de provisioning mediante Python3.
- No se instalaron estos builds ni se modificaron dispositivos. **Pendientes**: cold/warm launch visual, matriz física permisos/QR/ubicación/Android13+, capturas actuales iPhone/iPad/Android, aceptación de consolas y pruebas descargadas de TestFlight/Play. No confundir las suites unitarias con esa evidencia.
- Se preservaron los tres flags staging preexistentes de `apps/api/wrangler.jsonc`. Sin despliegues, producción, WhatsApp, commits ni subidas.

### Entrega local

`output/mobile/internal-staging-1003/` (ignorado por Git) contiene AAB, IPA, archive intermedio, ExportOptions, SHA256SUMS y verification.json. Los iconos/ficha gráfica están en `apps/mobile/assets/store/`; las capturas antiguas siguen siendo referencia, no un pack nuevo.
