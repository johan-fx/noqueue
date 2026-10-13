# Asignaciones de servicios para Personal de lista

## Comportamiento

`queue_staff` solo puede leer y operar los `queueIds` asignados. No se modifica
la matriz de capacidades de los demás roles ni las rutas públicas. El backend
filtra el catálogo antes de cargar datos derivados y devuelve 404 para lecturas
u operaciones sobre colas no asignadas. No hay fallback de acceso universal.

Alta y edición de detalles exigen al menos un ID único del establecimiento.
Guardar otro rol elimina los grants. El PATCH de membresía conserva las
asignaciones cuando solo cambia `active`, pero aplica las mismas reglas cuando
cambia el rol o se envían `queueIds`. Contraseña y restricciones de identidad
compartida/protegida conservan sus reglas existentes.

Las escrituras de identidad, membresía, asignaciones y auditoría son atómicas.
Las claves foráneas compuestas impiden asignaciones entre establecimientos.
La migración `0026_staff_queue_assignments.sql` copia una sola vez las colas
actuales, abiertas y cerradas, a cada membresía `queue_staff`, activa o revocada.
No reactiva cuentas y no añade grants para colas futuras. Un establecimiento
sin colas queda sin asignaciones y muestra «No tienes servicios asignados».

## Procedimiento de publicación (no ejecutado automáticamente)

1. Validar suites, tipos, lint, build y E2E antes de tocar el entorno remoto.
2. Establecer un bloqueo temporal de escrituras administrativas en el perímetro
   antes de migrar: POST de miembros, ambos PATCH de membresía/detalles, POST
   de colas y aprovisionamiento de establecimientos. Verificar que las
   peticiones reciben mantenimiento, incluso desde una pestaña antigua.
   Mantener las operaciones de turnos y lecturas disponibles. No basta con
   ocultar botones; si no se puede asegurar ese bloqueo, detener la publicación.
3. Aplicar las migraciones D1 pendientes al entorno elegido. Verificar que cada
   par de membresía `queue_staff` y cola del mismo establecimiento tiene su
   asignación; comprobar también que `active` no ha cambiado y que no hay
   relaciones cruzadas. No repetir manualmente el INSERT de backfill después.
4. Publicar API y assets web en el mismo Worker. No liberar las escrituras hasta
   que la nueva versión esté activa. Las pestañas antiguas sin `queueIds` deben
   recibir error de validación al crear/editar personal, nunca acceso global.
5. Con cuentas de prueba, verificar lectura/operación permitida, 404 de otra
   cola, alta/edición y la actualización de una sesión abierta. Retirar el
   bloqueo y supervisar errores de validación/503 y las auditorías de miembros.

La restricción se aplica en la siguiente petición del usuario. La UI se
reconcilia mediante polling cada cinco segundos tras completar una consulta y
al recuperar el foco; no es una revocación de datos ya descargados por el cliente.

No revertir solo la API a una versión con autorización global tras empezar a
restringir usuarios: reabriría permisos. Ante un problema, mantener bloqueadas
las escrituras/operaciones afectadas y corregir hacia delante. La tabla y los
grants deben conservarse.
