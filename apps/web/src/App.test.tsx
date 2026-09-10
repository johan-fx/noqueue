import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'

describe('App', () => {
  it('renders the web experience in a browser runtime', () => {
    render(<App />)

    expect(screen.getByText('No Queue · Web')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Join the queue' })).toBeInTheDocument()
  })
})
