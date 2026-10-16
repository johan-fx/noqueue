// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { googleTransport } from '../src/google'
afterEach(() => { document.head.innerHTML = ''; document.cookie = '_ga=; Max-Age=0; Path=/'; vi.restoreAllMocks() })
const page = { location: 'https://app.noqueue-app.com/q/queue', title: 'Queue' }
const commands = () => ((window as unknown as { dataLayer: IArguments[] }).dataLayer ?? []).map((args) => Array.from(args))
it('does not load Google before start and configures only sanitized manual views', () => {
  const g = googleTransport(); expect(document.querySelector('script')).toBeNull()
  g.start('G-TEST12345', 100, page); g.view(page)
  const script = document.querySelector('script')!; expect(script.referrerPolicy).toBe('no-referrer')
  expect(commands()).toEqual([]); script.dispatchEvent(new Event('load'))
  expect(commands().find((c) => c[0] === 'config')?.[2]).toMatchObject({ send_page_view: false, cookie_domain: 'none', cookie_update: false, cookie_expires: 100, page_referrer: '', allow_google_signals: false })
  expect(commands().filter((c) => c[0] === 'event')).toEqual([['event', 'page_view', { page_location: page.location, page_title: page.title, page_referrer: '' }]])
  g.stop(); g.view(page); expect(commands()).toEqual([])
  expect(Reflect.get(window, 'ga-disable-G-TEST12345')).toBe(true)
})
it('cancels a pending view when consent is withdrawn during script download', () => {
  const g = googleTransport(); g.start('G-TEST12345', 100, page); g.view(page)
  const script = document.querySelector('script')!; g.stop(); script.dispatchEvent(new Event('load'))
  expect(document.querySelector('script')).toBeNull(); expect(commands()).toEqual([])
})
it('retains only the current page while loading, never replays navigation history', () => {
  const g = googleTransport(); g.start('G-TEST12345', 100, page); g.view(page)
  g.view({ location: 'https://app.noqueue-app.com/search', title: 'Search' })
  document.querySelector('script')!.dispatchEvent(new Event('load'))
  expect(commands().filter((c) => c[0] === 'event')).toHaveLength(1)
  expect(commands().find((c) => c[0] === 'event')?.[2]).toMatchObject({ page_title: 'Search' })
})
