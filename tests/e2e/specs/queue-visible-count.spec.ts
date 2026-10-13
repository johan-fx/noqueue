import { test, expect, newClientContext } from '../fixtures.js'
import { fixture, supportEntry } from '../demo/fixtures.js'
import type { Entry } from '../../../packages/contracts/src/queue.js'

for (const type of ['restaurant', 'reception', 'pool'] as const) {
  test(`${type}: visual floor is not an extra turn or an ETA interval`, async ({ page, request, browser, baseURL }, info) => {
    test.setTimeout(60000)
    const f = await fixture(page, request, baseURL!, type, 'main', { interval: 4, tables: 1, approach: 2 })
    const guest = await newClientContext(browser, info, `virtual-${type}`, { baseURL: baseURL! })
    try {
      const client = await guest.newPage()
      for (const [index, display] of [1, 1, 2].entries()) {
        const joined = await supportEntry(guest.request, baseURL!, f.queue, type, `Count ${index}`) as { recoveryToken: string }
        const url = `/api/v1/public/entries/${joined.recoveryToken}`
        const before = await (await guest.request.get(url)).json() as Entry
        expect(before.position).toBe(index + 1)
        expect(before.etaMinutes).toBe((index + 1) * 4)
        for (const locale of ['es', 'en']) {
          await client.goto(`/t/${joined.recoveryToken}?lang=${locale}`)
          const word = locale === 'es' ? display === 1 ? 'turno' : 'turnos' : display === 1 ? 'turn' : 'turns'
          await expect(client.getByText(`${display} ${word}`, { exact: true })).toBeVisible()
          await expect(client.getByRole('progressbar')).toBeVisible()
        }
        await client.reload()
        const after = await (await guest.request.get(url)).json() as Entry
        expect(after.position).toBe(before.position)
        expect(after.predictedAt).toBe(before.predictedAt)
      }
      await client.screenshot({ path: info.outputPath(`visible-count-${type}.png`) })
    } finally {
      await guest.close()
    }
  })
}
