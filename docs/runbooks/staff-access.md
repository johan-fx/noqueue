# Alta manual y accesos — desarrollo

## Preparación local

1. Copiar `apps/api/.dev.vars.example` a `.dev.vars` (ignorado).
2. Configurar BETTER_AUTH_SECRET aleatorio (mínimo 32 caracteres) y las claves del
   dominio de colas. PUBLIC_APP_ORIGIN debe coincidir exactamente con el navegador.
   Frontend y `/api` usan el mismo origen; Vite usa proxy en desarrollo.
3. Instalar dependencias y aplicar migraciones locales:

```sh
pnpm install --frozen-lockfile
pnpm --filter @noqueue/api db:migrate:local
```

La migración 0005 es de desarrollo y aún no se ha desplegado. Si se aplicó su
versión anterior OTP en una base local, reconstruir una base **descartable** con las
migraciones; no ejecutar instrucciones de borrado contra datos que se quieran conservar.
No hay compatibilidad con el prototipo OTP.

4. Crear el comercial con `pnpm --filter @noqueue/api auth:bootstrap comercial "Comercial"`.
   El script SOLO opera en D1 local y lee la contraseña por stdin (15–128 caracteres).
   Entregar stdin desde un gestor de secretos o entrada oculta del shell: nunca
   poner contraseñas literales en argumentos, historial, logs ni archivos versionados.
   No cambia credenciales si el username existe. Después iniciar `pnpm dev`.
5. Abrir `/login` con usuario y contraseña. No se envía email ni hay cambio obligatorio.

## Operativa

- Comercial: `/staff` muestra el listado. «Crear nuevo» abre un Drawer: primero
  cliente/administrador («Crear establecimiento»), después configuración
  («Añadir servicio»). El guardado es atómico al finalizar el segundo paso; cancelar
  no crea un establecimiento incompleto. «Atrás» conserva los datos del borrador.
  Al guardar se cierra el Drawer y se refresca el listado.
  «Gestionar accesos» abre otro Drawer lateral con el alta de usuarios, roles,
  revocación/restauración y restablecimiento de contraseñas del establecimiento.
  Al cerrar se limpia el formulario y el foco vuelve al botón del listado.
- Se crean identidad, cuenta credential, organización, venue y membresías en un
  único batch D1. Colas inicialmente cerradas. El comercial NO es miembro del hotel.
- Entregar credenciales individuales por un canal seguro. No compartir cuentas.
  La contraseña no se puede consultar después; no se devuelve ni se almacena en
  respuestas idempotentes. Si se pierde, restablecerla con la identidad verificada.
- Establecimiento: `/staff` muestra los servicios como tarjetas responsivas (una columna móvil). «Añadir servicio»
  en la cabecera y «Configurar servicio» en cada fila abren Drawers con formulario
  y acciones fijas en el footer; guardar cierra y refresca, cancelar descarta el borrador.
  «Gestionar accesos» abre su propio Drawer para el owner. Los botones respetan
  los permisos por rol. «Gestionar cola» abre su Drawer con los turnos, filtros,
  actualización y acciones operativas; al cerrar, el foco vuelve al botón de la fila.
- Owner/comercial autorizado: Accesos → nombre, username, contraseña y rol.
  Usernames únicos globalmente, normalizados a minúsculas e inmutables (3–30,
  letras ASCII, números, punto o guion bajo). Nunca se reutiliza una cuenta ajena.
- Cambios/revocación de roles son efectivos en la siguiente petición.
- Restablecimiento manual: confirmar identidad, nueva contraseña y cierre de todas
  las sesiones. Owner solo personal subordinado; comercial solo su cartera; platform
  admin autorizado. Se rechazan identidades globales, propias y multi-organización.
- No se permite degradar/eliminar al owner desde estas pantallas.
- Dashboard y enlace público `/q/:id` siguen usando los permisos de servicio.
- Auditoría: GET `/api/v1/staff/venues/:id/audit`.
- Suspensión: PATCH `/api/v1/staff/commercial/organizations/:id/status`,
  `{ "status": "suspended" }` o `active`. Bloquea operación y nuevas altas públicas.

## Ajustes y correo opcional

`/settings/account`: nombre y email. `/settings/security`: cambio voluntario de
contraseña, requiere la actual y cierra otras sesiones. Mínimo 15 caracteres.

Las identidades iniciales tienen un email UUID en `accounts.noqueue.invalid`,
con `emailVerified=false`. **No se falsea la verificación**. El cambio de email
conserva la dirección anterior hasta verificar el enlace enviado a la nueva.
No se necesita acceder al buzón ficticio. Los permisos siguen ligados al userId.
El email real puede usarse también para login con la misma contraseña.

Para probar verificación sin salir de local, el setup usa `AUTH_EMAIL_API_KEY=local-inbox`.
Tras solicitar el cambio, leer el enlace en la memoria efímera del worker:

```sh
source apps/api/.dev.vars
curl -H "X-NoQueue-Dev-Token: $LOCAL_DEV_TOKEN" \
  "http://localhost:5173/api/v1/dev/local-mail?email=tu-email@example.com"
```

Abrir la URL de `text` en el navegador. Este buzón desaparece al reiniciar el
worker, no se registra en logs y responde solo en localhost con token. Para entrega
real usar AUTH_EMAIL_API_KEY (Resend) y AUTH_EMAIL_FROM (remitente verificado).
Si faltan, se rechaza el cambio sin alterar la dirección existente. No hay envíos en
el alta ni recuperación por email en esta fase.
Better Auth devuelve una respuesta uniforme aunque falle la entrega. La dirección
no cambia hasta verificarla; el servidor registra solo `auth_email_delivery_failed`
sin direcciones, tokens ni cuerpos. Configurar una alerta sobre ese evento.
Las operaciones sensibles de Better Auth pueden pedir volver a iniciar sesión.

## Antes de producción — NO ejecutado

Revisar migración/bindings y backup, aplicar migraciones al entorno explícito tras
aprobación; cargar secretos sin versionarlos. HTTPS, origen exacto, nodejs_compat.
Crear plataforma mediante procedimiento privilegiado con hash Better Auth; el
bootstrap local no soporta remoto y el seed E2E no es una API de producción.
Medir coste scrypt en Workers y elegir presupuesto CPU apropiado. Evaluar MFA para
comerciales/owners, controles de entrega de contraseñas y soporte de recuperación.
No desplegar `test/e2e-worker.ts`; entrada real `src/index.ts`.

## Validación sin correo real

```sh
pnpm check-types
pnpm lint
pnpm --filter @noqueue/api test
pnpm --filter @noqueue/web test
pnpm --filter @noqueue/contracts test
pnpm --filter @noqueue/e2e exec playwright test --project=chromium
```

E2E usa D1 descartable, correo interceptado y token local de pruebas. No utiliza
cuentas reales. Pendientes: Stripe/autoalta, MFA, transferencia owner, permisos por
zona, paginación histórica y retención/export de auditoría.

Para ejecutar E2E sin detener `pnpm dev`, usar `NOQUEUE_E2E_PORT=8877 pnpm --filter @noqueue/e2e exec playwright test --project=chromium`. El harness mantiene D1 y correo simulados aislados.
