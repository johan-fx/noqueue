import { test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { queueOrder } from '../helpers/queue-order.js'
import type { Step } from '../helpers/queue-actions.js'

test('record mobile queue order demonstration', async ({ browser, request, baseURL }, info) => {
  const root = process.env.QUEUE_DEMO_DIR!
  const contextOptions = {
    baseURL: baseURL!, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    recordVideo: { dir: `${root}/raw`, size: { width: 390, height: 844 } },
  }
  const staff = await browser.newContext(contextOptions)
  const page = await staff.newPage()
  const evidence: Step[] = []
  const moments: { event: string; at: number }[] = []
  const markers: number[] = []
  let start = 0, duration = 0, clientPaths: string[] = [], passed = false
  try {
    await queueOrder({ page, request, browser, baseURL: baseURL!, info, evidence, contextOptions,
      ready: async (...pages) => {
        // Full-viewport calibration is outside the business flow and trimmed away.
        await Promise.all(pages.map(p => p.evaluate(() => {
          const marker = document.createElement('div')
          marker.id = 'queue-demo-marker'
          marker.style.cssText = 'position:fixed;inset:0;background:#ff00ff;z-index:2147483647'
          document.body.append(marker)
        })))
        await new Promise(resolve => setTimeout(resolve, 1200))
        await Promise.all(pages.map(async (p, index) => {
          await p.evaluate(() => document.getElementById('queue-demo-marker')!.remove())
          markers[index] = performance.now()
        }))
        await new Promise(resolve => setTimeout(resolve, 1000))
        start = performance.now()
      },
      moment: async event => {
        moments.push({ event, at: (performance.now() - start) / 1000 })
        const holds = { intro: 10_000, 'alice-joined': 12_000, 'both-joined': 12_000, 'before-action': 8_000, 'confirm-action': 3_000, result: 15_000 }
        await new Promise(resolve => setTimeout(resolve, holds[event]))
        if (event === 'result') duration = (performance.now() - start) / 1000
      },
      recorded: async paths => { clientPaths = paths },
    })
    passed = true
  } finally {
    await staff.close()
    await writeFile(`${root}/scenario.json`, JSON.stringify({
      status: passed ? 'passed' : 'failed', duration, moments, evidence,
      assertions: passed ? { actual: evidence.at(-1)!.actual, expected: ['Bob', 'Alice'], alice: 2, bob: 1 } : null,
      videos: [{ path: await page.video()!.path(), afterMarker: (start - markers[0]!) / 1000 }, { path: clientPaths[0], afterMarker: (start - markers[1]!) / 1000 }],
      clock: 'Local monotonic performance.now; alignment is editorial, not a latency measurement',
    }, null, 2))
  }
})
