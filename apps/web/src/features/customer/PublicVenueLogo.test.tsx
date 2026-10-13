import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { PublicVenueLogo } from './PublicVenueLogo'

afterEach(cleanup)
it('leaves no empty branding slot without a logo', () => {
  const { container } = render(<PublicVenueLogo url={null} venueName="Hotel" />)
  expect(container).toBeEmptyDOMElement()
})
it('hides broken images and recovers on a new version or venue', () => {
  const { container, rerender } = render(<PublicVenueLogo url="/first.png" venueName="Hotel" />)
  fireEvent.error(screen.getByRole('img'))
  expect(container).toBeEmptyDOMElement()
  rerender(<PublicVenueLogo url="/second.png" venueName="Other hotel" />)
  expect(screen.getByRole('img', { name: 'Other hotel' })).toHaveAttribute('src', '/second.png')
  rerender(<PublicVenueLogo url={null} venueName="Other hotel" />)
  expect(container).toBeEmptyDOMElement()
})
