# Estimación adaptativa: simulación determinista local

- Semilla: 20261011; 12 clientes desde el inicio, referencia 4 minutos, acercamiento 2 minutos, umbral de corrección 5 minutos y cooldown 5 minutos. Variación reproducible de ±0,08 minutos; ráfagas conservan intervalos cero.
- **Anterior**: mínimo configurado apilado de v1, fechas ancladas, sin protección y preaviso una vez por entrada. **Rígido protegido**: comparación intermedia sin aprendizaje. **Adaptativo**: aprendizaje, protección y nuevos episodios de acercamiento.
- El estimador adaptativo se utiliza automáticamente al activar la cola; v1 queda como reversión técnica. No hay activación adicional ni requisito de histórico.
- Antes de un futuro despliegue conviene revisar los valores existentes: la UI anterior describía algunos como ocupación y ahora representan intervalos iniciales entre asignaciones. Se conservan los números guardados. La migración 0021 es aditiva; una reversión técnica explícita a versión 1 no borra observaciones ni históricos.
- El escenario carece de disponibilidad conocida de recursos: todas las estimaciones son provisionales. La referencia anterior reproduce su mínimo configurado, no todas sus posibles previsiones operativas de mesas.

## Error de previsión

MAE final: error de la última fecha persistida antes de la asignación real, incluidas revisiones preventivas. MAE del contador: error absoluto integrado durante toda la espera; si el contador anterior queda a cero, se contabiliza el tiempo real que todavía faltaba. Ambas métricas están en minutos.

| Escenario | MAE final anterior | Rígido protegido | Adaptativo | MAE contador anterior | Rígido protegido | Adaptativo |
|---|---:|---:|---:|---:|---:|---:|
| sequential | 22.02 | 3.00 | 3.01 | 7.36 | 0.78 | 0.79 |
| bursts | 6.13 | 3.65 | 2.56 | 9.69 | 12.72 | 11.39 |
| acceleration | 17.91 | 2.28 | 2.45 | 4.64 | 5.27 | 4.98 |
| slowdown | 30.65 | 2.27 | 2.01 | 17.39 | 9.01 | 8.24 |
| stall | 82.08 | 5.71 | 5.08 | 63.42 | 51.58 | 42.58 |

## Protección y volumen de avisos

Las prórrogas cuentan cambios preventivos por cliente, incluidas propagaciones a posteriores. Los avisos son decisiones de política suponiendo aceptación inmediata, no mensajes enviados; se aplica cooldown y la excepción de magnitud solo a la primera protección del episodio. Una corrección y un acercamiento no se contabilizan juntos.

| Escenario | Clientes/minutos-cliente a cero anterior | Prórrogas anterior | Prórrogas rígido | Prórrogas adaptativo | Avisos anterior | Avisos rígido | Avisos adaptativo |
|---|---:|---:|---:|---:|---:|---:|---:|
| sequential | 11 / 144.19 | 0 | 78 | 78 | 24 | 34 | 34 |
| bursts | 9 / 24.52 | 0 | 30 | 39 | 25 | 28 | 29 |
| acceleration | 12 / 98.85 | 0 | 50 | 63 | 25 | 37 | 40 |
| slowdown | 12 / 240.14 | 0 | 99 | 78 | 24 | 43 | 41 |
| stall | 11 / 832.98 | 0 | 258 | 148 | 20 | 224 | 152 |

Todos los escenarios protegidos verifican cero minutos-cliente con el contador agotado. La referencia anterior verifica cero prórrogas y como máximo un acercamiento por entrada.

## Interpretación y límites

- La revisión ocurre **antes** de la fecha prevista. Puede extender una previsión que se habría cumplido: no conoce la siguiente asignación real. Evitar el cero no garantiza reducir el error; este coste se conserva deliberadamente según el plan aprobado.
- Se importan los ayudantes de producción de cadencia, proyección, protección y política de avisos. El simulador replica en memoria las correcciones antes/después en el mismo instante y la propagación serial; una asignación real establece el origen del siguiente intervalo para no descontar dos veces el avance; no desplaza fechas por ticks ni entrena con predicciones. El primer evento de asignación no produce ratio y una protección repetida conserva su episodio.
- Es una simulación sintética con una semilla, no una medición de precisión en establecimientos. No cubre disponibilidad/compatibilidad real, ocupación aprendida, pausas, transacciones D1, reinicios del coordinador ni fallos de entrega. Estos aspectos se validan separadamente mediante pruebas automatizadas de integración; no se ha realizado aquí una prueba con navegador o proveedor real.
- Los avisos anteriores son una aproximación de umbral/cooldown sobre el mínimo configurado; su procedencia operativa histórica completa no se reproduce. No utilizar estos volúmenes como previsión comercial de WhatsApp.
- Reproducción: `node --experimental-strip-types scripts/queue-verification/adaptive-simulation.mjs`. Solo escribe este informe local; no ejecuta migraciones ni envía mensajes.
