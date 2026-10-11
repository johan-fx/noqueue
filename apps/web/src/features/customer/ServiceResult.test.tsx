import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it } from 'vitest'
import type { PublicSearchResult } from '@noqueue/contracts/discovery'
import { ServiceResult } from './ServiceResult'
afterEach(cleanup)
it.each(['restaurant', 'reception', 'pool'] as const)(
  'shows public-only floor for active empty %s without inflating real counts',
  (type) => {
    const service = {
      id: 'q',
      venueId: 'v',
      name: 'Service',
      venueName: 'Venue',
      type,
      address: 'Street',
      open: true,
      serviceOpen: true,
      queueState: 'active',
      waitingPeople: 0,
      waitMinutes: null,
      distanceMeters: null,
      attribution: [],
    } as PublicSearchResult
    const view = render(
      <MemoryRouter>
        <ServiceResult service={service} locale="en" returnTo="/search" />
      </MemoryRouter>,
    )
    expect(screen.getByText('1 people waiting')).toBeVisible()
    view.rerender(
      <MemoryRouter>
        <ServiceResult
          service={{ ...service, waitingPeople: 1 }}
          locale="en"
          returnTo="/search"
        />
      </MemoryRouter>,
    )
    expect(screen.getByText('1 people waiting')).toBeVisible()
    view.rerender(
      <MemoryRouter>
        <ServiceResult
          service={{ ...service, waitingPeople: 0, queueState: 'inactive' }}
          locale="en"
          returnTo="/search"
        />
      </MemoryRouter>,
    )
    expect(screen.getByText('0 people waiting')).toBeVisible()
  },
)
