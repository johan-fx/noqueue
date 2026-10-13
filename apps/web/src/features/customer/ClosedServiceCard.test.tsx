import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ClosedServiceCard } from './ClosedServiceCard'
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})
it.each(['es', 'en'] as const)(
  'counts down using server time despite a skewed device (%s)',
  (locale) => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2030-01-01T00:00:00Z'))
    const serverNow = Date.parse('2026-10-13T10:00:00Z')
    const { rerender } = render(
      <ClosedServiceCard
        name="Restaurante"
        opening={{ at: serverNow + 3660000, serverNow, localTime: '13:01' }}
        receivedAt={Date.now()}
        locale={locale}
      />,
    )
    expect(
      screen.getByText(
        locale === 'es' ? 'Abre a las 13:01h' : 'Opens at 13:01',
      ),
    ).toBeVisible()
    expect(
      screen.getByText(
        locale === 'es'
          ? 'Podrás apuntarte en 01:01:00'
          : 'You can join in 01:01:00',
      ),
    ).toBeVisible()
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(
      screen.getByText(
        locale === 'es'
          ? 'Podrás apuntarte en 01:00:59'
          : 'You can join in 01:00:59',
      ),
    ).toBeVisible()
    act(() => {
      vi.advanceTimersByTime(59000)
    })
    expect(
      screen.getByText(
        locale === 'es'
          ? 'Podrás apuntarte en 01:00:00'
          : 'You can join in 01:00:00',
      ),
    ).toBeVisible()
    rerender(
      <ClosedServiceCard
        name="Restaurante"
        opening={{ at: serverNow + 1000, serverNow, localTime: '12:00' }}
        receivedAt={Date.now()}
        locale={locale}
      />,
    )
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(
      screen.getByText(
        locale === 'es'
          ? 'Comprobando disponibilidad…'
          : 'Checking availability…',
      ),
    ).toBeVisible()
    expect(screen.getByRole('article')).toHaveAttribute('aria-disabled', 'true')
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(
      screen.getByRole('article').querySelector('.lucide-arrow-right'),
    ).toBeNull()
    expect(
      screen.getByRole('article').querySelector('.lucide-ticket'),
    ).toBeNull()
  },
)

it('keeps total hours beyond a day and counts down across hour and minute boundaries', () => {
  vi.useFakeTimers()
  const now = Date.now()
  const { rerender, unmount } = render(
    <ClosedServiceCard
      name="Restaurant"
      opening={{ at: now + 90061000, serverNow: now, localTime: '12:00' }}
      receivedAt={now}
      locale="es"
    />,
  )
  expect(screen.getByText('Podrás apuntarte en 25:01:01')).toBeVisible()
  rerender(
    <ClosedServiceCard
      name="Restaurant"
      opening={{ at: now + 3600000, serverNow: now, localTime: '12:00' }}
      receivedAt={now}
      locale="es"
    />,
  )
  act(() => {
    vi.advanceTimersByTime(1000)
  })
  expect(screen.getByText('Podrás apuntarte en 00:59:59')).toBeVisible()
  act(() => {
    vi.advanceTimersByTime(3598000)
  })
  expect(screen.getByText('Podrás apuntarte en 00:00:01')).toBeVisible()
  act(() => {
    vi.advanceTimersByTime(1000)
  })
  expect(screen.getByText('Comprobando disponibilidad…')).toBeVisible()
  unmount()
  expect(vi.getTimerCount()).toBe(0)
})
