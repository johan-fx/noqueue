import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import {
  cadenceFactor,
  projectAdaptiveQueue,
  protectionRemainingMs,
  safetyMarginMs,
} from '../../apps/api/src/features/queue/adaptive-model.ts'
import { evaluateAdaptiveNotice } from '../../apps/api/src/features/queue/estimate-notices.ts'

const seed = 20261011,
  minute = 60000,
  count = 12,
  C = 4 * minute,
  A = 2 * minute,
  cooldown = 5 * minute
const config = {
  type: 'restaurant',
  averageMinutes: 4,
  approachMinutes: 2,
  spaces: [],
}
const reportPath = fileURLToPath(
  new URL('../../docs/queue-adaptive-simulation-report.md', import.meta.url),
)
let randomState = seed
function jitter(n) {
  randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0
  return n === 0
    ? 0
    : Math.max(0.25, n + (randomState / 4294967296 - 0.5) * 0.16)
}
const traces = {
  sequential: Array(count).fill(4),
  bursts: [4, 0, 0, 4, 0, 0, 4, 0, 0, 4, 0, 0],
  acceleration: [4, 4, 4, 3.5, 3.2, 3, 2.8, 2.6, 2.4, 2.2, 2, 1.8],
  slowdown: [4, 4, 4, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9],
  stall: [4, 4, 4, ...Array(9).fill(20)],
}
function run(intervals, policy) {
  const protectedModel = policy !== 'legacy',
    learning = policy === 'adaptive'
  const all = intervals.map((_, i) => ({
    id: String(i),
    sequence: i + 1,
    partySize: 2,
    at: (i + 1) * C,
    cadence: C,
    history: [{ at: 0, predicted: (i + 1) * C }],
    armed: true,
    delayBaseline: null,
    safety: 0,
    acceptedSafety: 0,
    acceptedAt: (i + 1) * C,
    correctedAt: null,
    reason: 'cadence',
  }))
  let waiting = [...all],
    now = 0,
    lastAssignment = null,
    factor = 1,
    revision = 0
  const ratios = [],
    metrics = {
      extensions: 0,
      safetyNotices: 0,
      correctionNotices: 0,
      approaches: 0,
    }
  const project = (parties, at, f) =>
    projectAdaptiveQueue(parties, [], at, config, 4, f)
  function recalc(beforeRaw) {
    const raw = project(waiting, now, factor)
    let previous = null,
      propagated = false
    revision++
    for (const [index, p] of waiting.entries()) {
      const forecast = raw[index],
        old = p.at,
        S = safetyMarginMs(forecast.cadenceMs, 2)
      let next =
        protectedModel && beforeRaw
          ? forecast.predictedAt
          : old +
            (beforeRaw
              ? forecast.predictedAt - beforeRaw.get(p.id).predictedAt
              : 0)
      let reason = beforeRaw ? 'cadence' : p.reason
      const prePropagation = next
      if (previous !== null)
        next = Math.max(next, previous + forecast.cadenceMs)
      const inherited = propagated && next > prePropagation
      const due = protectedModel && next - S <= now
      if (due)
        next = Math.max(
          next,
          forecast.predictedAt,
          now +
            protectionRemainingMs(
              forecast.cadenceMs,
              S,
              now - (lastAssignment ?? 0),
            ),
        )
      if (due || inherited) reason = 'safety'
      if (next > old && p.delayBaseline === null) p.delayBaseline = old
      if (p.delayBaseline !== null && next <= p.delayBaseline) {
        p.delayBaseline = null
        p.safety = 0
      }
      if ((due || inherited) && !p.safety) p.safety = revision
      if (protectedModel && next !== old && next - now > A + S && !p.armed)
        p.armed = true
      p.at = next
      p.cadence = forecast.cadenceMs
      p.reason = reason
      if (next !== old) {
        if (p.history.at(-1).at === now) p.history.at(-1).predicted = next
        else p.history.push({ at: now, predicted: next })
      }
      if (due || inherited) metrics.extensions++
      const approach = p.armed && next - now <= A
      if (approach) p.armed = false
      // Simulator assumes immediate successful delivery. No provider calls.
      // Legacy keeps lifetime approaching dedup and ordinary threshold/cooldown.
      const firstSafety =
        p.safety > p.acceptedSafety && p.delayBaseline !== null
      const notice = evaluateAdaptiveNotice({
        previousAcceptedAt: p.acceptedAt,
        currentPredictedAt: next,
        lastCorrectionAcceptedAt: p.correctedAt,
        thresholdMinutes: 5,
        cooldownMinutes: cooldown / minute,
        now,
        reason: firstSafety ? 'safety' : reason,
        safetyRevision: p.safety,
        lastAcceptedSafetyRevision: p.acceptedSafety,
      })
      if (approach && notice !== 'delayed') {
        metrics.approaches++
        p.acceptedAt = next
      } else if (notice) {
        if (notice === 'delayed' && firstSafety) {
          metrics.safetyNotices++
          p.acceptedSafety = p.safety
        } else metrics.correctionNotices++
        p.acceptedAt = next
        p.correctedAt = now
      }
      previous = next
      propagated =
        due || inherited || (p.delayBaseline !== null && p.safety > 0)
    }
  }
  function nextAlarm() {
    const candidates = []
    for (const p of waiting) {
      if (p.armed) candidates.push(Math.max(now, p.at - A))
      if (protectedModel)
        candidates.push(Math.max(now, p.at - safetyMarginMs(p.cadence, 2)))
      if (p.correctedAt !== null && p.correctedAt + cooldown > now)
        candidates.push(p.correctedAt + cooldown)
    }
    return Math.min(...candidates)
  }
  let actual = 0
  for (const interval of intervals) {
    actual += interval * minute
    let guard = 0
    while (nextAlarm() < actual) {
      assert(++guard < 10000, 'alarm loop')
      now = nextAlarm()
      recalc()
    }
    now = actual
    const beforeRaw = new Map(
      project(waiting, now, factor).map((p) => [p.id, p]),
    )
    const assigned = waiting.shift()
    assigned.actual = actual
    assigned.latestError = Math.abs(actual - assigned.at) / minute
    // First assignment in the demand episode has no interval sample.
    if (lastAssignment !== null) ratios.push((actual - lastAssignment) / C)
    lastAssignment = actual
    factor = learning ? cadenceFactor(ratios) : 1
    recalc(beforeRaw)
  }
  let integral = 0,
    wait = 0,
    zero = 0,
    zeroParties = 0
  for (const p of all) {
    let zeroMs = 0
    wait += p.actual
    for (const [i, h] of p.history.entries()) {
      const end = Math.min(p.actual, p.history[i + 1]?.at ?? p.actual)
      if (end <= h.at) continue
      const positiveEnd = Math.min(end, h.predicted)
      if (positiveEnd > h.at)
        integral += (positiveEnd - h.at) * Math.abs(p.actual - h.predicted)
      const zeroStart = Math.max(h.at, h.predicted)
      if (end > zeroStart) {
        integral +=
          p.actual * (end - zeroStart) - (end ** 2 - zeroStart ** 2) / 2
        zeroMs += end - zeroStart
      }
    }
    zero += zeroMs
    if (zeroMs > 0) zeroParties++
  }
  if (protectedModel) assert.equal(zero, 0, 'protected forecast reached zero')
  if (!protectedModel) {
    assert.equal(metrics.extensions, 0)
    assert(metrics.approaches <= count)
  }
  return {
    ...metrics,
    latestMae: all.reduce((s, p) => s + p.latestError, 0) / count,
    displayMae: integral / wait / minute,
    zeroParties,
    zeroMinutes: zero / minute,
    notices:
      metrics.safetyNotices + metrics.correctionNotices + metrics.approaches,
  }
}
const scenarios = Object.entries(traces).map(([name, trace]) => {
  const intervals = trace.map(jitter)
  return {
    name,
    legacy: run(intervals, 'legacy'),
    rigid: run(intervals, 'rigid'),
    adaptive: run(intervals, 'adaptive'),
  }
})
const f = (n) => n.toFixed(2)
const report = `# Estimación adaptativa: simulación determinista local

- Semilla: ${seed}; 12 clientes desde el inicio, referencia 4 minutos, acercamiento 2 minutos, umbral de corrección 5 minutos y cooldown 5 minutos. Variación reproducible de ±0,08 minutos; ráfagas conservan intervalos cero.
- **Anterior**: mínimo configurado apilado de v1, fechas ancladas, sin protección y preaviso una vez por entrada. **Rígido protegido**: comparación intermedia sin aprendizaje. **Adaptativo**: aprendizaje, protección y nuevos episodios de acercamiento.
- El estimador adaptativo se utiliza automáticamente al activar la cola; v1 queda como reversión técnica. No hay activación adicional ni requisito de histórico.
- Antes de un futuro despliegue conviene revisar los valores existentes: la UI anterior describía algunos como ocupación y ahora representan intervalos iniciales entre asignaciones. Se conservan los números guardados. La migración 0021 es aditiva; una reversión técnica explícita a versión 1 no borra observaciones ni históricos.
- El escenario carece de disponibilidad conocida de recursos: todas las estimaciones son provisionales. La referencia anterior reproduce su mínimo configurado, no todas sus posibles previsiones operativas de mesas.

## Error de previsión

MAE final: error de la última fecha persistida antes de la asignación real, incluidas revisiones preventivas. MAE del contador: error absoluto integrado durante toda la espera; si el contador anterior queda a cero, se contabiliza el tiempo real que todavía faltaba. Ambas métricas están en minutos.

| Escenario | MAE final anterior | Rígido protegido | Adaptativo | MAE contador anterior | Rígido protegido | Adaptativo |
|---|---:|---:|---:|---:|---:|---:|
${scenarios
  .map(
    (s) =>
      `| ${s.name} | ${f(s.legacy.latestMae)} | ${f(s.rigid.latestMae)} | ${f(
        s.adaptive.latestMae,
      )} | ${f(s.legacy.displayMae)} | ${f(s.rigid.displayMae)} | ${f(
        s.adaptive.displayMae,
      )} |`,
  )
  .join('\n')}

## Protección y volumen de avisos

Las prórrogas cuentan cambios preventivos por cliente, incluidas propagaciones a posteriores. Los avisos son decisiones de política suponiendo aceptación inmediata, no mensajes enviados; se aplica cooldown y la excepción de magnitud solo a la primera protección del episodio. Una corrección y un acercamiento no se contabilizan juntos.

| Escenario | Clientes/minutos-cliente a cero anterior | Prórrogas anterior | Prórrogas rígido | Prórrogas adaptativo | Avisos anterior | Avisos rígido | Avisos adaptativo |
|---|---:|---:|---:|---:|---:|---:|---:|
${scenarios
  .map(
    (s) =>
      `| ${s.name} | ${s.legacy.zeroParties} / ${f(s.legacy.zeroMinutes)} | ${
        s.legacy.extensions
      } | ${s.rigid.extensions} | ${s.adaptive.extensions} | ${
        s.legacy.notices
      } | ${s.rigid.notices} | ${s.adaptive.notices} |`,
  )
  .join('\n')}

Todos los escenarios protegidos verifican cero minutos-cliente con el contador agotado. La referencia anterior verifica cero prórrogas y como máximo un acercamiento por entrada.

## Interpretación y límites

- La revisión ocurre **antes** de la fecha prevista. Puede extender una previsión que se habría cumplido: no conoce la siguiente asignación real. Evitar el cero no garantiza reducir el error; este coste se conserva deliberadamente según el plan aprobado.
- Se importan los ayudantes de producción de cadencia, proyección, protección y política de avisos. El simulador replica en memoria las correcciones antes/después en el mismo instante y la propagación serial; una asignación real establece el origen del siguiente intervalo para no descontar dos veces el avance; no desplaza fechas por ticks ni entrena con predicciones. El primer evento de asignación no produce ratio y una protección repetida conserva su episodio.
- Es una simulación sintética con una semilla, no una medición de precisión en establecimientos. No cubre disponibilidad/compatibilidad real, ocupación aprendida, pausas, transacciones D1, reinicios del coordinador ni fallos de entrega. Estos aspectos se validan separadamente mediante pruebas automatizadas de integración; no se ha realizado aquí una prueba con navegador o proveedor real.
- Los avisos anteriores son una aproximación de umbral/cooldown sobre el mínimo configurado; su procedencia operativa histórica completa no se reproduce. No utilizar estos volúmenes como previsión comercial de WhatsApp.
- Reproducción: \`node --experimental-strip-types scripts/queue-verification/adaptive-simulation.mjs\`. Solo escribe este informe local; no ejecuta migraciones ni envía mensajes.
`
await writeFile(reportPath, report)
console.log(JSON.stringify({ seed, reportPath, scenarios }, null, 2))
