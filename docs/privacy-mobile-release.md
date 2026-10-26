# Permisos y privacidad móvil — preparación para Internal Testing

Auditoría de la app Capacitor en el estado del código fuente. No es una declaración legal ni sustituye las fichas **App Privacy** de App Store Connect o **Data safety** de Play Console: esas fichas deben reflejar también los servicios y tratamientos del backend.

## Matriz de permisos y capacidades

| Capacidad | Declaración nativa | Cuándo se usa/solicita | Denegación y alternativa |
| --- | --- | --- | --- |
| Notificaciones push | Android recibe `POST_NOTIFICATIONS` de la dependencia Capacitor Local Notifications; iOS tiene Push Notifications y `aps-environment` en `App.entitlements`. FCM tiene auto-init desactivado en ambos manifiestos. | No se solicita al arrancar. Se comprueba el estado y solo se registra tras una admisión/activación o el CTA explícito de notificaciones: `apps/web/src/platform/capacitor/push-registration.ts`. En Android también se verifican las notificaciones de la app y el canal `queue-updates`: `push-permissions.ts`. | Tras un rechazo, no se fuerza inmediatamente Ajustes. Si el usuario vuelve a activar manualmente y ya no hay permiso solicitables, se intenta abrir los ajustes de notificaciones; si el SO no los abre, se intenta la página de ajustes de la app. Desactivar permiso revoca la inscripción del backend. |
| Cámara | Android declara `CAMERA` y la capacidad de cámara es opcional (`required="false"`); iOS declara `NSCameraUsageDescription`. | Solo al abrir el escáner QR desde Descubrir. `QrScanner.tsx` usa `getUserMedia` indirectamente mediante ZXing, con `audio: false`, y detiene el stream al cerrar/salir. | El error muestra una alternativa de búsqueda manual; no se requiere la cámara para el resto de la app. |
| Ubicación | Android declara `ACCESS_COARSE_LOCATION`; `ACCESS_FINE_LOCATION` está limitado a API 30 o anterior, y GPS es opcional. iOS incluye `NSLocationWhenInUseUsageDescription` y la clave Always requerida por la dependencia Geolocation de Capacitor. | Solo cuando la persona elige «Usar mi ubicación»/«Use my location». `discovery-capabilities.ts` solicita `coarseLocation` en Android y hace una lectura puntual (`getCurrentPosition`, precisión alta desactivada); no hay seguimiento continuo. El cuerpo de búsqueda cercana contiene las coordenadas elegidas (`discovery-request.ts`). | Si el permiso o la lectura falla, se conserva la búsqueda manual y se muestra un error con opción de reintentar. La ubicación se borra del estado de descubrimiento al desactivarla; esto no cambia el permiso del SO. |
| Internet | Android declara `INTERNET` (permiso normal). iOS no necesita un permiso de usuario equivalente. | Comunicación normal con API y FCM. | Sin red, las funciones remotas no están disponibles; no se presenta un diálogo de permiso de SO. |

### Solicitudes que el código no necesita

- No se detecta uso de micrófono, biblioteca/fotos del usuario, almacenamiento multimedia, ubicación en segundo plano, contactos, Bluetooth, SMS ni calendario. El escáner solicita vídeo únicamente; no añadir esos permisos/usage strings por anticipación.
- El `FileProvider` presente es infraestructura de Capacitor Android; por sí solo no implica permiso de lectura de fotos o almacenamiento.
- La clave iOS `NSLocationAlwaysAndWhenInUseUsageDescription` se conserva para cumplir el requisito documentado por el plugin Geolocation de Capacitor, que depende de `ion-ios-geolocation`; **la app no pide autorización Always ni declara background location**. No añadir `UIBackgroundModes` ni solicitar permiso Always sin una nueva función aprobada.
- La descripción iOS de red local solo se incorpora al `Info.plist` del producto `Debug`; `Release` elimina la clave. No declarar red local como capacidad de producción.

## FCM/APNs: permiso del usuario no equivale a credenciales

- **Android**: para que la app obtenga token y envíe push hacen falta `google-services.json` correspondiente a `com.noqueueapp.android` y configuración FCM del backend. `apps/mobile/android/app/build.gradle` ya advierte que sin el JSON las push no funcionan. El manifiesto ahora fija icono y color por defecto de notificación; esos recursos deben existir en Android.
- **iOS**: el target declara la capacidad Push y el entitlement `aps-environment`; Debug usa `development` y Release `production`. Firebase Cloud Messaging para iOS requiere además una clave de autenticación APNs configurada en el proyecto Firebase, independiente del permiso concedido por la persona.
- La app iOS entrega al backend un **token FCM**, no el token APNs: `push-registration.ts` y `packages/native-fcm/ios/Sources/NoQueueFcmPlugin/NoQueueFcmPlugin.swift`. La credencial de servicio usada por el backend para enviar mensajes es independiente de las configuraciones cliente; no empaquetar secretos de servidor en la app.
- El resultado probado contra staging no demuestra que la configuración de las apps Firebase de release, el entitlement de distribución y credenciales APNs/FCM de producción sean correctos. Antes de subir, verificar los binarios/configuraciones del entorno elegido sin copiar secretos al repositorio.

## Privacidad de Apple y revisión de tiendas

- En este repositorio no hay un `PrivacyInfo.xcprivacy` propio de la app. El árbol instalado de Capacitor iOS incluye manifests de los frameworks Capacitor/CapacitorCordova. Comprobar el archivo y las firmas SDK del **archive final**, porque el resultado depende de todas las dependencias efectivamente enlazadas; no inventar declaraciones de recolección ni de API reasons.
- La app envía coordenadas al endpoint de búsqueda cuando se elige la búsqueda cercana, y envía el token FCM al endpoint de inscripción tras habilitar push. Contrastar esos flujos con la política de privacidad, la declaración de privacidad de App Store Connect (incluidos SDK/terceros) y Data safety de Play Console; declarar solo después de revisar almacenamiento, vinculación a identidad, finalidad y retención del backend.
- Confirmar que ambas fichas de tienda enlazan a la política de privacidad pública vigente. Los permisos del sistema y la etiqueta de privacidad son requisitos distintos.

## Comprobaciones nativas para el build candidato

1. En el `Info.plist` del `.app` de **Release**, confirmar que existen las cadenas de cámara y ubicación localizadas (`en`/`es`) y que **no** aparece `NSLocalNetworkUsageDescription`; en Debug debe aparecer esa clave con el texto limitado a servidor de desarrollo.
2. Revisar el manifiesto **fusionado de Release**, no solo el fuente: `POST_NOTIFICATIONS`, cámara opcional, coarse location, `INTERNET` y metadatos default de FCM presentes; `RECEIVE_BOOT_COMPLETED`, `LocalNotificationRestoreReceiver`, `SCHEDULE_EXACT_ALARM` y `USE_EXACT_ALARM` ausentes.
3. En dispositivos Android 13+ probar concesión, denegación y bloqueo desde Ajustes de notificaciones/canal. En iOS probar notificaciones permitidas y denegadas, y cámara/ubicación aceptadas y rechazadas; comprobar siempre las alternativas de búsqueda manual.
4. Revisar por separado configuración/credenciales Firebase y APNs, Privacy manifests/firmas de SDK y los formularios de privacidad de las dos tiendas.

## Fuentes oficiales

- [Apple: usage description de cámara](https://developer.apple.com/documentation/bundleresources/information-property-list/nscamerausagedescription)
- [Apple: uso de ubicación Always frente a When In Use](https://developer.apple.com/documentation/bundleresources/information-property-list/nslocationalwaysandwheninuseusagedescription)
- [Capacitor: Geolocation iOS y requisitos de Info.plist](https://next.capacitorjs.com/docs/apis/geolocation)
- [Android: permiso de notificaciones en tiempo de ejecución](https://developer.android.com/develop/ui/compose/notifications/notification-permission)
- [Android: reglas de fusión de manifiestos](https://developer.android.com/build/manage-manifests)
- [Firebase: icono y color predeterminados de FCM en Android](https://firebase.google.com/docs/cloud-messaging/android/get-started)
- [Firebase: prerequisitos de FCM en Apple, incluida clave APNs](https://firebase.google.com/docs/ios/setup)
- [Apple: privacy manifests de SDKs de terceros](https://developer.apple.com/support/third-party-SDK-requirements/)
- [Apple: declaraciones App Privacy](https://developer.apple.com/app-store/app-privacy-details/)
