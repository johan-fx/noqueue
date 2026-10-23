import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { SummaryStep } from './SummaryStep'
import { emptyService } from './model'

afterEach(cleanup)

it('shows the service-level automatic-management badge when enabled', () => {
  render(
    <SummaryStep
      values={{
        ...emptyService,
        automaticAssignmentEnabled: true,
        scheduleGroups: [
          { days: [1], twentyFourHours: true, ranges: [] },
        ],
      }}
    />,
  )
  expect(screen.getByText('Gestión automática activa')).toBeVisible()
})

it('hides the automatic-management badge by default', () => {
  render(<SummaryStep values={emptyService} />)
  expect(screen.queryByText('Gestión automática activa')).not.toBeInTheDocument()
})
