# Verificación en navegador: cronómetro adaptativo

Fecha: 11 de octubre de 2026. Aplicación local real en Chromium; datos ficticios. No se modificó el comportamiento del producto para esta grabación.

## Actualización posterior: ajustes solicitados tras el vídeo

El informe y el vídeo largo de abajo conservan los resultados de la primera grabación. Después se corrigió el cero fugaz con un formateador compartido que redondea hacia arriba los segundos positivos, se movió la explicación de demora inmediatamente encima del estado verde y se añadieron los countdowns de espera y llegada del personal. El badge de espera utiliza la misma fecha pública que el cliente, sin sustituir la disponibilidad operativa.

La nueva verificación local está en `queue-demo-output/ui-countdowns-verified-2026-10-11/`: `resumen.mp4` (40,8 segundos), `flujo-completo.mp4` (71 segundos reales) y `verification.json`. Se usó una referencia de un minuto exclusivamente en la configuración de la prueba, sin alterar los relojes. Se verificaron la prórroga, la posición de ambos avisos al desplazar la página, la asignación y la llegada. La regresión subsegundo online/offline se cubrió con pruebas de componentes; no se repitió aquí el vídeo largo completo.

El personal conserva su sincronización de datos cada cinco segundos; el contador se repinta cada segundo. Las revisiones pueden llegar en instantes distintos y los ticks independientes pueden mostrar temporalmente un segundo de diferencia pese a compartir la fecha absoluta. Los archivos de vídeo, datos ficticios y trazas permanecen locales e ignorados por Git.

## Vídeos

- [Resumen — 4:58 aproximadamente, esperas ×20](/Users/usuario/Sites/noqueue-app.com/queue-demo-output/adaptive-final-2026-10-11/resumen.mp4).
- [Grabación completa — 18:48, a velocidad real](/Users/usuario/Sites/noqueue-app.com/queue-demo-output/adaptive-final-2026-10-11/flujo-completo.mp4).
- [Evidencia técnica de edición y comprobaciones](/Users/usuario/Sites/noqueue-app.com/queue-demo-output/adaptive-final-2026-10-11/delivery.json).

Los tiempos de espera transcurrieron realmente. No se usaron relojes falsos, avance de fechas ni respuestas simuladas del estimador. Solo se aceleró la reproducción de las esperas en la edición; las acciones, transiciones y momentos confirmados permanecen a velocidad normal. El contador superior indica tiempo real transcurrido dentro de cada capítulo. No se recortaron intervalos del recorrido registrado, salvo la preparación/autenticación anterior al marcador de inicio.

## Resultado

**Resultado parcial: el flujo principal funciona, pero NO cumple completamente «nunca mostrar cero».** La revisión detectó un 0:00 fugaz durante la desconexión; está conservado a velocidad normal y señalado en el vídeo.

Se completaron cinco capítulos y 50 comprobaciones explícitas originales fueron satisfactorias, además de las comprobaciones de visibilidad. La revisión posterior de telemetría añadió **una comprobación fallida** que aquellos tests no cubrían. La automatización ya incorpora esa comprobación para futuras ejecuciones; el defecto del producto no se ha corregido. Son escenarios independientes, no una única persona esperando dieciocho minutos.

| Inicio del resumen | Capítulo | Tiempo real grabado | Resultado |
|---|---|---|---|
| 0:00 | Apilado público 4/8/12 | 0:21 | Cumple en esta escena |
| 0:21 | Protección, reacercamiento y llegada | 6:38 | Cumple en esta escena |
| 1:59 | Aprendizaje rápido, lento y cancelación | 6:03 | Cumple en esta escena |
| 3:23 | Desconexión y recuperación | 4:24 | Parcial: cero fugaz |
| 4:22 | Expiración del reloj de llegada | 1:21 | Cumple en esta escena |

### Hechos observados

1. **Apilado:** con tres mesas libres, las tres páginas públicas muestran previsiones próximas a cuatro, ocho y doce minutos, menos los segundos transcurridos desde cada inscripción. El estimador v2 se utiliza por defecto, sin un interruptor adicional.
2. **Colores y progreso:** espera negra → acercamiento naranja → espera negra con explicación de demora → nuevo acercamiento naranja → asignación roja → llegada verde. La barra circular progresa con el reloj y puede retroceder cuando aumenta la previsión.
3. **Protección:** con intervalo inicial de cuatro minutos y preaviso de dos, la primera revisión ocurre a los **3.00 minutos** desde la inscripción, aproximadamente un minuto antes del vencimiento. Devuelve la espera restante a unos cuatro minutos. Se registra una segunda prórroga alrededor de los seis minutos, sin asignar ni cancelar automáticamente.
4. **Aprendizaje gradual:** después de cuatro asignaciones reales hay tres intervalos válidos de aproximadamente **5,6 segundos**. El intervalo aprendido pasa de **240 s a 146.82 s** (factor 0.612). No salta a cinco segundos: conserva el peso de la referencia inicial.
5. **Ralentización:** la siguiente asignación ocurre **310.71 s** después de la anterior —cinco minutos de espera deliberada más las operaciones visibles—. El intervalo efectivo aumenta a **169.01 s**. Las previsiones no se usan como entrenamiento.
6. **Cancelación:** el siguiente cliente avanza una posición; siguen existiendo cinco observaciones de asignación, sin crear una sexta muestra ficticia.
7. **Desconexión:** el servidor prorroga aunque el navegador esté sin conexión. Al final de la previsión antigua se observa **0:00 durante aproximadamente un segundo**, y después aparece «Sin conexión». Es una discrepancia con el criterio solicitado, aunque el servidor ya había prorrogado correctamente. Reconectar y recargar conservan la fecha de inscripción.
8. **Llegada:** la asignación inicia un plazo independiente de cinco minutos en el capítulo principal. En otro capítulo, configurado expresamente a un minuto, el reloj rojo sí llega a expirar y el personal ve «Caducado».

Se recopilaron **1076 lecturas de interfaz**, principalmente a una por segundo. Se observó **1 lectura de espera en 0:00** fuera del estado rojo. Esto describe el muestreo y no sustituye una prueba exhaustiva de todos los posibles estados.

## Incidencia pendiente: 0:00 durante la desconexión

En el segundo **244,79 del capítulo offline**, el registro muestra el contador naranja en 0:00 y progreso del 100%; el muestreo siguiente muestra «Sin conexión». También se ha comprobado visualmente en el MP4. El fragmento no se acelera alrededor del fallo.

Causa identificada en [TurnView.tsx](/Users/usuario/Sites/noqueue-app.com/apps/web/src/features/customer/TurnView.tsx): el contador utiliza redondeo hacia abajo de los segundos, pero el estado de previsión agotada solo se activa cuando predictedAt <= now. En los últimos milisegundos positivos ya puede dibujarse 0:00.

**Corrección recomendada, no implementada aquí:** evitar representar cero mientras quede espera positiva —por ejemplo, redondear hacia arriba únicamente el reloj de espera— y mostrar el estado de actualización/desconexión al agotarse la fecha. Conservar sin cambios la expiración del reloj de llegada. Añadir pruebas específicas para 999 ms, 1 ms y 0 ms, tanto conectado como desconectado.

## Otros dos matices importantes

### El «0 min» del personal no es el cronómetro del cliente

En la toma de tres mesas libres, el personal muestra «0 min» de disponibilidad operativa, mientras los clientes ven 4/8/12 apilados. No se ha modificado ni ocultado esta diferencia. Corresponde a la separación actual entre disponibilidad real y previsión pública; **su presentación puede resultar confusa** y convendría aclarar las etiquetas en una tarea posterior. Esta grabación no demuestra que ambas pantallas comuniquen el mismo concepto.

### Avisos en pantalla sí; entrega completa de WhatsApp, no

Se verifica la explicación persistente de demora, los estados de acercamiento y la generación de registros de aviso. El entorno E2E elimina los cron triggers y simula los proveedores: algunos avisos de espera quedan pendientes o se retiran por obsolescencia antes de una llamada. La inscripción y la llamada tienen acuses simulados. **No se ha validado la entrega automática completa ni el volumen real de WhatsApp**, y no se ha enviado ningún mensaje real. No debe atribuirse ese comportamiento del entorno aislado a producción sin probar también el reconciliador programado.

## Calidad, incidencias y límites

- Las cinco escenas finales usan el mismo código de aplicación/contratos/migraciones, verificado por huellas. Se conservan los fuentes exactos del grabador por intento y las trazas disponibles.
- Ensayos previos detectaron suposiciones incorrectas de la automatización: activación sin segundo diálogo, reconfirmación legítima tras un cambio concurrente y texto real de la pantalla de baja. Se corrigió el grabador, no el producto.
- Un ensayo de aprendizaje perdió sus trazas al compartir directorio de resultados con otra ejecución. Se descartó de la entrega y se repitió **completo, con otros cinco minutos reales de espera**, en un directorio independiente. La nueva toma pasó; la procedencia se conserva en recording-provenance.json.
- Validación del grabador: **20 tests unitarios/de navegador auxiliar pasaron**, TypeScript E2E y `git diff --check` sin errores. Esto no convierte la comprobación de cero en satisfactoria.
- Los MP4 se comprobaron con FFprobe y decodificación completa. La revisión visual cubre fotogramas representativos de los momentos registrados; no equivale a afirmar que se ha visionado manualmente cada fotograma de los dieciocho minutos.
- Esta prueba demuestra escenarios reproducibles, no precisión estadística con datos de restaurantes reales. Las llegadas/liberaciones rápidas son deliberadamente ficticias; no validan una duración de comida representativa.
- No se probaron aquí todas las combinaciones de grupos incompatibles, horarios, pausas, reintentos o navegadores. Los tests previos del estimador siguen siendo una validación complementaria, no reemplazada por el vídeo.
- Sin despliegues, migraciones remotas ni dependencias nuevas. La base de datos utilizada es efímera/local y se bloquean las salidas de red no simuladas del worker.
- Los metadatos y vídeos crudos contienen enlaces de recuperación de las identidades ficticias; compartir únicamente los MP4 revisados y este informe, no las trazas privadas.

## Índice detallado del resumen

Los segundos pueden variar unas décimas por la conversión a 25 fps.

| Minuto | Escena | Qué sucede |
|---|---|---|
| 0:00 | baseline | Cliente 1 · Previsión inicial 4 minutos (menos el tiempo transcurrido) · 3 mesas libres |
| 0:07 | baseline | Cliente 2 · Previsión inicial 8 minutos (menos el tiempo transcurrido) · 3 mesas libres |
| 0:14 | baseline | Cliente 3 · Previsión inicial 12 minutos (menos el tiempo transcurrido) · 3 mesas libres |
| 0:21 | protection | Activar la lista con el restaurante lleno · Inteligencia automática |
| 0:31 | protection | Espera inicial · El reloj desciende segundo a segundo |
| 0:49 | protection | Naranja · Se alcanza el margen de acercamiento de 2 minutos |
| 1:03 | protection | Prórroga automática antes de cero · Motivo visible · No hay asignación |
| 1:20 | protection | Nuevo acercamiento · La explicación de demora permanece |
| 1:32 | protection | Segunda prórroga · El turno sigue esperando, no se cancela |
| 1:37 | protection | Ahora el personal libera una mesa real |
| 1:44 | protection | Rojo · Asignación definitiva · Comienza un reloj distinto de 5 minutos |
| 1:54 | protection | Verde · Llegada confirmada por el personal |
| 2:05 | learning | Apilado inicial 4 / 8 / 12 · María espera detrás de cuatro turnos |
| 2:12 | learning | Datos actualizados · El personal revisa y confirma de nuevo |
| 2:17 | learning | Asignación real rápida · Carlos Previo |
| 2:23 | learning | Asignación real rápida · Elena Previa |
| 2:29 | learning | Asignación real rápida · Diego Previo |
| 2:34 | learning | Asignación real rápida · Nora Previa |
| 2:40 | learning | La cadencia aprendida reduce las previsiones · Conserva el histórico |
| 3:07 | learning | Asignación después de 5 minutos · El ritmo aprendido aumenta |
| 3:12 | learning | Cancelación real · No añade una muestra de atención |
| 3:18 | learning | El siguiente cliente avanza sin entrenar una falsa atención |
| 3:28 | offline | Espera inicial · El reloj desciende segundo a segundo |
| 3:48 | offline | Cliente sin conexión · El servidor local sigue funcionando |
| 4:02 | offline | Incidencia observada - 0:00 fugaz antes de Sin conexión |
| 4:06 | offline | Sin conexión sustituye la cifra · No se anuncia disponibilidad |
| 4:12 | offline | Reconexión · Recupera la previsión protegida del servidor |
| 4:17 | offline | Recargar conserva el turno y la fecha original de inscripción |
| 4:27 | expiration | Espera inicial · El reloj desciende segundo a segundo |
| 4:37 | expiration | Escena independiente · Plazo de llegada configurado a 1 minuto |
| 4:53 | expiration | Caducado por el servidor · No se confirmó llegada |

## Reproducción local

Desde el repositorio, con Chromium y FFmpeg ya instalados:

`FFMPEG_PATH=/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg FFPROBE_PATH=/opt/homebrew/opt/ffmpeg-full/bin/ffprobe pnpm demo:queue:adaptive`

La ejecución es opt-in, secuencial y sin reintentos automáticos. Mientras siga el defecto descrito, la nueva comprobación de cero puede marcar la escena offline como fallida; eso es evidencia, no un motivo para ocultar la grabación. Mantener directorios de resultados distintos si se lanzan otras pruebas en paralelo.

## Key Learnings:

1. La protección y los cambios de color se observan con tiempo real, sin depender de un reloj simulado.
2. La cadencia aprende gradualmente: 240 → 146.82 → 169.01 segundos en este escenario.
3. El redondeo de los últimos milisegundos todavía permite un cero fugaz offline; queda pendiente corregirlo sin alterar el reloj de llegada.
4. La disponibilidad mostrada al personal y la espera pública son conceptos distintos; su presentación merece una aclaración.
