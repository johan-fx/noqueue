import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { replayMetadata } from './replay.mjs'
export default class EvidenceReporter {
  onTestRunEnd(testModules) {
    if (!process.env.QUEUE_REPORT_DIR) return
    // Final inventory is authoritative; Worker streaming callbacks can be duplicated or missed.
    const cases = testModules.flatMap((module) =>
      Array.from(module.children.allTests(), (test) => ({
        id: test.fullName.match(/\bQ-[A-Z-]+\b/)?.[0] ?? test.fullName,
        status:
          test.result().state === 'passed'
            ? 'passed'
            : test.result().state === 'failed'
            ? 'failed'
            : 'skipped',
        steps: test.meta().queueEvidence ?? [],
        errors: test.result().errors?.map((e) => e.message),
        replay: replayMetadata(
          test.fullName.match(/\bQ-[A-Z-]+\b/)?.[0],
          process.env,
          test.result().errors?.map((e) => e.message),
        ),
      })),
    )
    mkdirSync(process.env.QUEUE_REPORT_DIR, { recursive: true })
    writeFileSync(
      path.join(process.env.QUEUE_REPORT_DIR, 'api-evidence.json'),
      JSON.stringify(cases, null, 2),
    )
  }
}
