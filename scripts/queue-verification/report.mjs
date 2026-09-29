import { isDeepStrictEqual } from 'node:util'
export function verdict(required, scenarios) {
  return (
    required.length > 0 &&
    required.every((id) =>
      scenarios.some(
        (s) => s.id === id && s.status === 'passed' && s.steps?.length > 0,
      ),
    ) &&
    scenarios.every(
      (s) =>
        s.status === 'passed' &&
        s.steps?.length > 0 &&
        s.steps.every(
          (step) =>
            Object.hasOwn(step, 'actual') &&
            Object.hasOwn(step, 'expected') &&
            isDeepStrictEqual(step.actual, step.expected),
        ),
    )
  )
}
const escape = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
export function render(report) {
  const commandTable = `<h2>Execution</h2><table><tr><th>Check</th><th>Outcome</th><th>Duration</th></tr>${(
    report.commands ?? []
  )
    .map(
      (command) =>
        `<tr><td><a href="${escape(command.label)}.log">${escape(
          command.label,
        )}</a></td><td>Exit ${escape(command.code)}</td><td>${Math.round(
          command.durationMs / 1000,
        )} s</td></tr>`,
    )
    .join('')}</table>`
  const diagnostics = report.scenarios.flatMap((s) => {
    if (s.status !== 'passed') return [`${s.id}: ${s.status}`]
    if (!s.steps.length) return [`${s.id}: required evidence is missing`]
    if (
      s.steps.some(
        (step) =>
          !Object.hasOwn(step, 'actual') ||
          !Object.hasOwn(step, 'expected') ||
          !isDeepStrictEqual(step.actual, step.expected),
      )
    )
      return [
        `${s.id}: recorded evidence is incomplete or contradicts the expected result`,
      ]
    return []
  })
  for (const id of report.required ?? [])
    for (const browser of report.expectedBrowsers ?? [])
      if (
        id.startsWith('Q-BROWSER-') &&
        !report.scenarios.some((s) => s.id === id && s.browser === browser)
      )
        diagnostics.push(`${id}: ${browser} was not executed`)
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>Queue verification</title><style>body{font:16px system-ui;max-width:1100px;margin:3rem auto;padding:1rem;color:#182331}table{border-collapse:collapse;width:100%}td,th{padding:10px;text-align:left;border-bottom:1px solid #ddd}pre{white-space:pre-wrap;overflow-wrap:anywhere}summary{padding:12px;background:#eef2f7;cursor:pointer}h1{color:${
    report.passed ? '#06744b' : '#ad301d'
  }}</style><h1>${
    report.passed ? 'Passed' : 'Needs attention'
  } — Queue verification</h1><p>Revision ${escape(
    report.revision,
  )} · ${escape(report.profile)} · ${
    report.dirty ? 'working tree changes' : 'clean checkout'
  }</p><p>Deterministic synthetic evidence, not a guarantee of real-world prediction accuracy.</p><p><a href="playwright/index.html">Browser report and traces</a> · <a href="evidence.json">Machine-readable evidence</a></p>${commandTable}${
    diagnostics.length
      ? `<h2>Diagnostics</h2><ul>${diagnostics
          .map((message) => `<li>${escape(message)}</li>`)
          .join('')}</ul>`
      : ''
  }${report.scenarios
    .map(
      (s) =>
        `<details><summary>${escape(s.id)} — ${escape(s.status)} ${escape(
          s.browser ?? '',
        )}</summary>${
          s.replay
            ? `<h3>Reproduce (${escape(
                s.replay.profile ?? 'recorded configuration',
              )})</h3><pre>${escape(s.replay.command)}</pre>`
            : ''
        }${(s.errors ?? [])
          .map((error) => `<pre>${escape(error)}</pre>`)
          .join(
            '',
          )}<table><tr><th>Event / simulated time</th><th>Expected</th><th>Observed</th></tr>${s.steps
          .map(
            (step) =>
              `<tr><td>${escape(step.step ?? 'assertion')}<br>${escape(
                step.simulatedAt ?? '',
              )}</td><td><pre>${escape(
                JSON.stringify(step.expected, null, 2),
              )}</pre></td><td><pre>${escape(
                JSON.stringify(step.actual, null, 2),
              )}</pre></td></tr>`,
          )
          .join('')}</table></details>`,
    )
    .join('')}</html>`
}
