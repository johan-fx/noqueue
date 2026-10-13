import { createHash } from 'node:crypto'
import {
  test as base,
  expect,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type TestInfo,
} from '@playwright/test'

export function deriveClientIpAddress(input: {
  projectName: string
  testId: string
  repeatEachIndex: number
  retry: number
  clientLabel: string
}) {
  const digest = createHash('sha256')
    .update(
      [
        input.projectName,
        input.testId,
        input.repeatEachIndex,
        input.retry,
        input.clientLabel,
      ].join('\0'),
    )
    .digest('hex')
  const prefix = `fd${digest.slice(0, 14)}`
  const groups = prefix.match(/.{4}/g)
  if (!groups) throw new Error('invalid_e2e_client_prefix')
  return `${groups.join(':')}::1`
}

export function clientIpAddress(info: TestInfo, clientLabel = 'primary') {
  return deriveClientIpAddress({
    projectName: info.project.name,
    testId: info.testId,
    repeatEachIndex: info.repeatEachIndex,
    retry: info.retry,
    clientLabel,
  })
}

export async function newClientContext(
  browser: Browser,
  info: TestInfo,
  clientLabel: string,
  options: BrowserContextOptions = {},
) {
  const context = await browser.newContext({
    ...options,
    extraHTTPHeaders: {
      ...options.extraHTTPHeaders,
      'CF-Connecting-IP': clientIpAddress(info, clientLabel),
    },
  })
  // The app's opportunistic PWA update banner is unrelated to queue-flow
  // assertions and can cover controls in long-running E2Es. Defer only the
  // non-forced update prompt; dedicated PWA tests use Playwright's base fixture.
  context.on('page', (page) => {
    void page
      .addLocatorHandler(
        page.getByTestId('pwa-update-later'),
        async (later) => later.click(),
      )
      .catch(() => undefined)
  })
  return context
}

const test = base.extend<{}, { context: BrowserContext; request: APIRequestContext }>({
  context: async ({ browser, contextOptions }, use, info) => {
    const context = await newClientContext(
      browser,
      info,
      'primary',
      contextOptions as BrowserContextOptions,
    )
    await use(context)
    await context.close()
  },
  request: async ({ playwright, baseURL }, use, info) => {
    const request = await playwright.request.newContext({
      ...(baseURL ? { baseURL } : {}),
      extraHTTPHeaders: { 'CF-Connecting-IP': clientIpAddress(info) },
    })
    await use(request)
    await request.dispose()
  },
})

export { test, expect }
export type {
  APIRequestContext,
  Browser,
  BrowserContext,
  BrowserContextOptions,
  Locator,
  Page,
  TestInfo,
} from '@playwright/test'
