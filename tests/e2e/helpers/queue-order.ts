import {
  expect,
  type Browser,
  type BrowserContextOptions,
  type Page,
  type APIRequestContext,
  type TestInfo,
  newClientContext,
} from '../fixtures.js'
import { setup, join, act, prove, type Step } from './queue-actions.js'

export type OrderEvent =
  | 'intro'
  | 'alice-joined'
  | 'both-joined'
  | 'before-action'
  | 'confirm-action'
  | 'result'
export async function queueOrder(options: {
  page: Page
  request: APIRequestContext
  browser: Browser
  baseURL: string
  evidence: Step[]
  info: TestInfo
  contextOptions?: BrowserContextOptions
  ready?: (staff: Page, alice: Page) => Promise<void>
  moment?: (event: OrderEvent) => Promise<void>
  recorded?: (paths: string[]) => Promise<void>
}) {
  const { page, request, browser, baseURL, evidence, info } = options
  const t = await setup(page, request, baseURL, 'reception')
  const contexts = []
  try {
    for (let i = 0; i < 2; i++)
      contexts.push(
        await newClientContext(browser, info, `queue-client-${i + 1}`, {
          ...options.contextOptions,
          baseURL,
        }),
      )
    const alice = await contexts[0]!.newPage(),
      bob = await contexts[1]!.newPage()
    await alice.goto(`/q/${t.queue}`)
    await options.ready?.(page, alice)
    await options.moment?.('intro')
    await join(alice, t.queue, 'Alice', 1)
    await expect(alice.getByText('0 turnos', { exact: true })).toBeVisible()
    await options.moment?.('alice-joined')
    await join(bob, t.queue, 'Bob', 1)
    await expect(alice.getByText('0 turnos', { exact: true })).toBeVisible()
    await expect(bob.getByText('1 turnos', { exact: true })).toBeVisible()
    await options.moment?.('both-joined')
    await options.moment?.('before-action')
    await options.moment?.('confirm-action')
    await page
      .getByRole('button', { name: 'Asignar próximo turno', exact: true })
      .click()
    await expect(alice.getByText(/Es tu turno/)).toBeVisible()
    await expect(bob.getByText('1 turnos', { exact: true })).toBeVisible()
    const rows = page
      .getByRole('dialog', { name: 'Gestionar lista', exact: true })
      .locator('li')
    await expect(rows.filter({ hasText: 'Bob' })).toBeVisible()
    await expect
      .poll(async () => {
        const response = await page.request.get(
          `/api/v1/staff/queues/${t.queue}/entries`,
        )
        const list = (await response.json()) as {
          displayName: string
          status: string
        }[]
        return list
          .filter((entry) => entry.status === 'waiting')
          .map((entry) => entry.displayName)
      })
      .toEqual(['Bob'])
    const list = (await (
      await page.request.get(`/api/v1/staff/queues/${t.queue}/entries`)
    ).json()) as { displayName: string; status: string }[]
    await prove(
      info,
      evidence,
      'Q-BROWSER-ORDER',
      'quick assignment follows global waiting sequence',
      list
        .filter((entry) => entry.status === 'waiting')
        .map((entry) => entry.displayName),
      ['Bob'],
    )
    await options.moment?.('result')
    await page.screenshot({ path: info.outputPath('staff-quick-assigned.png') })
    // Resolve video paths only after their owning contexts have flushed recording.
    await Promise.all(contexts.map((context) => context.close()))
    if (options.recorded)
      await options.recorded([
        await alice.video()!.path(),
        await bob.video()!.path(),
      ])
  } finally {
    await Promise.all(contexts.map((context) => context.close()))
  }
}
