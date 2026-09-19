# ADR 0004 — Alta comercial y acceso multi-tenant

Estado: implementado en desarrollo, 2026-09-19.

## Decisión

Better Auth 1.7.5 fijado, con adaptador D1 directo, plugins Organization,
Admin y Email OTP. React usa el cliente oficial y Hono publica únicamente los
endpoints necesarios de sesión/OTP. No hay autoalta, contraseñas compartidas,
impersonación comercial ni acceso público a las mutaciones de Organization/Admin.

- Una organización representa al cliente; venue representa el establecimiento;
  queue representa un servicio de restaurante, recepción o piscina.
- Los roles de plataforma (commercial_operator/platform_admin) son independientes
  del rol operativo. Un comercial no se convierte en propietario del cliente.
- venue_membership es la autoridad para owner, venue_manager, queue_staff y viewer.
  Better Auth member vincula identidad/organización, pero su role no debe usarse
  para autorizar recursos de dominio ni mutaciones HTTP genéricas.
- El propietario gestiona accesos y servicios aunque todavía no exista facturación.
- El comercial gestiona sus clientes y sus invitaciones; platform_admin todos.
- Solo identidades precreadas pueden usar OTP. La invitación no es credencial:
  requiere sesión con email verificado coincidente, pendiente y sin caducar.
- Las altas son idempotentes. Organización, servicios cerrados, invitación,
  auditoría y resultado se confirman en un batch D1. La identidad precreada puede
  quedar huérfana ante fallo, pero sin permisos.
- La aceptación usa SQL acotado sobre el esquema canónico BA para confirmar member,
  venue scope y consumo de invitación en un batch; evita aceptación multi-step.
  Toda actualización de Better Auth exige revisar esquema/adaptador y pruebas.
- Fechas Better Auth: ISO TEXT en D1; dominio: milisegundos. No mezclar.
- Comandos de cola serializados en Durable Object, permisos comprobados de nuevo,
  versiones optimistas e idempotencia. La suspensión bloquea siguientes operaciones.
- Email transaccional Resend; errores de invitación no revierten el alta y se
  muestran para reenvío. OTP no se guarda en claro ni se registra.
- Origen exacto, cookies HttpOnly/Secure fuera de local, sesiones 12h sin cookie
  cache, límites de tamaño y frecuencia, roles leídos de DB en cada operación.

## Evolución

provisioning_mode=sales y billing_mode=manual no equivalen a suscripción Stripe.
El futuro self-service debe reutilizar validadores y servicio de provisioning
con políticas explícitas de creador y activación comercial, sin abrir endpoints
genéricos. Stripe necesitará estados, webhooks verificados e idempotencia propios.

## Límites actuales

Roles por establecimiento, no asignación fina por cola/zona; sin transferencia
de propietario desde UI. Polling 5s, no SLA realtime de 2s. La UI staff inicial
es española, funcional ShadCN, no réplica completa de Figma. Espacios/mesas se
configuran pero no hay asignación automática de mesas ni ocupación física:
capacity limita grupos en espera (personas en piscina), no personas ya atendidas.
No facturas/Stripe, MFA/passkeys, autoalta ni auth nativa. El nuevo acceso público
/q/:id no solicita WhatsApp; los experimentos previos conservan su flujo.

## Actualización de producto — 2026-09-19: username/password

Esta decisión sustituye el diseño inicial de OTP e invitaciones por correo descrito
arriba. El alta manual crea credenciales individuales y membresías directas en un
batch D1, sin envíos. Better Auth username + emailAndPassword; email sintético UUID
`.invalid`, sin verificar. No signup público ni `mustChangePassword`.

El comercial/owner establece una contraseña (mínimo15, máximo128), la entrega por
canal seguro y no puede recuperarla posteriormente. Hash scrypt de Better Auth.
La idempotencia de provisioning usa HMAC del payload (incluida contraseña), no un
hash público que permita probar contraseñas offline. Resultados no incluyen secretos.
Se rechazan usernames existentes: nunca resetear/reutilizar una identidad implícitamente.

Better Auth UI Settings y hooks con formularios adaptados a RHF/Zod: nombre,
verificación de nuevo email sin buzón anterior, contraseña voluntaria con actual.
Reset manual auditado y scoped revoca sesiones; no permite cuentas de plataforma o
multi-organización. Se mantiene autorización por IDs, no por email o username.
Correo es opcional para operar y necesario únicamente para confirmar nuevo email.
