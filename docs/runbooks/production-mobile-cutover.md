# Preparación local de producción móvil — 27/10/2026

## Alcance

Esta preparación **no despliega, no aplica SQL remoto, no cambia consolas, no instala secretos y no envía WhatsApp/push**. Los perfiles describen un candidato futuro; no representan el estado activo. Los SQL históricos permanecen intactos.

Inventario remoto de referencia del 27/10: producción tiene 0001–0028 aplicadas, WhatsApp cloud V4 y analítica web activos; no tiene tablas móviles ni bindings de push. Revalidarlo antes del corte. No copiar la base de staging, sus usuarios, outbox, consentimientos, tokens o flags de admisión silenciosa.

## Perfiles separados

| Perfil | Origen API | Analítica | WhatsApp | Push | Gestión automática |
| --- | --- | --- | --- | --- | --- |
| Backend/web `mobile-production` | Web same-origin | Web/landing ON, preserva perfil previo | ON, preserva aprobaciones V4 | FCM Android/iOS ON | ON |
| Móvil `production` | `https://app.noqueue-app.com` absoluto | OFF, sin GA4 | No configura servidor | Cliente ON | Usa backend |
| Móvil `internal-staging` | `https://staging.noqueue-app.com` | OFF | No configura servidor | Cliente ON | Usa staging |

El baseline de Wrangler permanece OFF; no desplegarlo directamente. El preset explícito evita desactivar el WhatsApp productivo por los defaults del repositorio. `FCM_IOS_BUNDLE_ID=com.noqueue-app.ios`; Android usa `com.noqueueapp.android`. El plugin iOS NoQueueFcm queda habilitado solo en iOS; Android sigue su transporte FCM habitual.

Comandos **locales** de preparación:

```sh
pnpm production:migrations:plan
pnpm test:production
pnpm --filter @noqueue/mobile test
pnpm check-types
pnpm lint
pnpm --filter @noqueue/api test
pnpm production:build:mobile
pnpm mobile:release:prepare --profile production --build-number 1009
```

`1009` es un número candidato para el ensayo local, **no reservado ni cargado**. Reconfirmar unicidad por plataforma antes de firmar. Prepare compila web, añade marcador/hash y sincroniza Capacitor: no genera IPA/AAB, firma, provisiona ni sube nada. API/web build solo usa Wrangler `--dry-run`. Ambos procesos reutilizan `apps/web/dist`: no ejecutarlos simultáneamente; después de un build web, repetir prepare antes de volver a sincronizar móvil. No hacer un `cap sync` genérico sobre una distribución web same-origin/GA ON.

Para auditar posteriormente binarios **ya firmados**, usar `mobile:release:verify --profile production --build-number N` con `--android-aab`, `--expected-android-upload-cert-sha256` y `--ios-ipa` (o archive). No usar `--allow-unsigned` como aprobación de tienda. El auditor exige perfil/orígenes coincidentes, hash, firmas, identidades, FCM, privacidad, APNs production y ausencia de servidor live-reload. Un prepare correcto no acredita push real ni storeReady.

## Las 12 migraciones, en orden

| SQL | Cambio / precaución |
| --- | --- |
| 0029_mobile_installations | Vinculación instalación–turno; no toca contactos/consentimientos WA. |
| 0030_mobile_push | Registros/outbox push y trigger inicial; sin histórico nuevo. |
| 0031_mobile_single_active_turn | Aborta ante instalaciones con varios turnos activos; nunca cancela para arreglarlos. |
| 0032_mobile_fcm_ios | Añade plataforma; retira registros APNs antiguos y descarta solo sus pendientes/en envío. No convierte tokens APNs a FCM. |
| 0033_mobile_push_lifecycle | Reconstruye outbox push preservando IDs/resultados, añade event_key legacy y vistas de lectura. No reenvía histórico. |
| 0034_arrival_replacement | Registro de sustituciones por vencimiento. |
| 0035_replacement_decisions | Decisiones pendientes de sustitución. |
| 0036_automation_cycles | Ciclos y referencias; manual_only por defecto 0; sin backfill de ciclos. |
| 0037_staff_queue_interactions | Prioridad y registro de acciones del personal. |
| 0038_automation_history_cleanup | Limpia referencia a ciclo antes de eliminarlo. |
| 0039_staging_whatsapp_suppression | Añade whatsapp_suppressed=0. **No habilita** admisión silenciosa en producción. |
| 0040_automation_attention | Atención/intervención pendiente, sin backfill. |

El planner es offline, identifica nombres/SHA-256 y marca `remoteRead:false, applied:false`. No acepta opciones de aplicación. Manifest de release v3 fija inventario y hashes; cambiar SQL después del build invalida el candidato. Se mantienen lectores de manifiestos v2 históricos, pero el rollback debe superar también las guardas actuales.

Ensayo sintético incremental 0028→0040: compara todas las filas/columnas preexistentes, incluidos contactos, consentimiento, privacidad, webhooks y estados WA pending/sending/unknown/failed/read/cancelled; comprueba ausencia de backfill, FK/integridad/FTS. Incluye aborto transaccional de 0031 y conservación de FCM frente a retirada APNs 0032/0033. No sustituye un ensayo con backup productivo cifrado.

## Pendientes antes de autorizar ejecución remota

1. Congelar commit/release y custodiar artefactos/hashes. Releer ledger, versión activa, colas/outbox y actividad. La referencia 0028 no es una aprobación permanente.
2. Backup productivo **nuevo**, cifrado y con restauración probada; acordar ventana y monitorización. No restaurar una copia antigua sobre escrituras posteriores. Las 12 migraciones no son una transacción global: si falla una, parar y comprobar ledger antes de reintentar; no borrar historial ni cancelar turnos automáticamente.
3. Aplicar SQL revisado por separado, solo tras autorización. Confirmar 0001–0040, FK/integridad, ausencia de cambios WA inesperados y ausencia de duplicados activos móviles.
4. Provisionar en producción por canal seguro, por separado y con autorización: `MOBILE_PUSH_TOKEN_KEY` (clave nueva de producción, no copiar la de staging), `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY`. Proyecto esperado `nq-app-f3127`; validar permisos FCM/APNs y correspondencia de apps. No rotar ni sobrescribir claves WA/PII/recovery existentes. En esta preparación no se han leído ni escrito valores secretos.
5. Desplegar únicamente el candidato verificado con autorización explícita de analítica, WA, push y automatización. El wrapper comprueba metadata de bindings, identidad D1 y ledger completo. Rechaza desactivar WA activo salvo confirmación separada `--confirm-disable-whatsapp`. Estas comprobaciones no envían mensajes ni prueban la validez criptográfica de credenciales.
6. Prueba controlada **autorizada** contra producción: nueva instalación Android/iOS, alta, push foreground/background/tap, turno/automatización y canal web WA. Sin reproducción de histórico ni mensajes a usuarios no participantes. Vigilar duplicados, fallos/reintentos, cola, cron e intervención manual. Poder desactivar push/automatización conservando WA mediante otro perfil revisado.
7. Generar/firmar IPA y AAB production desde el mismo código, verificar, probar y solo después subirlos. Completar fichas, privacidad, Data Safety, acceso de revisión, capturas iPhone/iPad/Android, categoría/edad, disponibilidad/precios y estrategia de publicación en ambas tiendas. Las builds staging 1007/1008 no se pueden promover como production.

## Rollback

Preferir rollback de código/flags compatible con el esquema expandido; conservar tablas y datos nuevos. Un rollback a un binario anterior puede no conocer outbox/ciclos nuevos: revisar antes y detener dispatch nuevo si procede. Mantener WA ON y no reproducir envíos con resultado desconocido. No hay down-migrations automáticas. Restaurar backup exige plan explícito de escrituras posteriores y autorización independiente.

## Evidencia local de esta preparación

- Producción/tooling: **63/63** tests; móvil: **74/74**.
- API: **951/951** tests (71 archivos) y **15/15** tests de herramientas; D1/workerd local, `remoteBindings:false`, proveedores simulados. Se necesitó permitir puertos localhost fuera del sandbox; ninguna prueba usa producción.
- Web: **960/960** tests (88 archivos).
- Tipos: **6/6** paquetes; lint: **6/6**, sin errores, con dos advertencias existentes de React Hooks/incompatible-library.
- Build backend/web/landing y Wrangler **dry-run** completados. Candidato local `20261027125347171-both-wa-on-6d48ef`, manifest v3, hashes/configuración verificados, `published:false`. Es un snapshot del trabajo local, no un commit cerrado ni una release aprobada para desplegar.
- Prepare móvil `production`, número candidato **1009**, build web y sync iOS/Android completados. SHA de payload `bd163eeb45218da1d36cc66868e973e8a31024e0b172af7f78794ca96b075011` idéntico en ambos proyectos; auditoría de JS compilado confirma origen production, sin staging/GA4/loopback no permitido; gates nativos comprobados, sin live-reload.
- **No ejecutado**: migración/backup remoto, instalación de bindings, despliegue, envío WA/push, pruebas físicas production, generación/firma de nuevos binarios o cargas/cambios de tiendas. No inferir que push productivo funciona solo por estos tests.

### Revisión de recuperación posterior

La captura de 66 tablas/409 filas (SQL de restauración 304.627 bytes) ya ha
pasado el ensayo **D1 remoto aislado**: batch único de 543 sentencias,
comparación de datos/esquema/secuencias, integridad/FK y FTS correctos. La base
temporal se eliminó con confirmación HTTP 404. Se usó el archivo cifrado guardado,
sin peticiones a producción y sin aplicar 0029–0040. El antiguo bloqueo de 95 kB
agregados queda resuelto para este backup: el nuevo límite es 95 kB por sentencia
y 1 MiB por batch; véase [d1-recovery.md](d1-recovery.md) para evidencia y límites.

Los cambios de tooling invalidan los hashes de fuente del candidato de la
preparación inicial: revisarlos/cerrarlos y reconstruir antes de plantear un
despliegue. Sigue siendo necesario un backup fresco si hay escrituras posteriores,
custodia externa separada de clave/archivo y autorización explícita para el corte.
