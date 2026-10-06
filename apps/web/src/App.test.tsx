import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'

describe('App', () => {
  it('renders the web experience in a browser runtime', async () => {
    render(<App />)

    expect(await screen.findByText('No Queue')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', {
        name: '¿Dónde quieres unirte a la lista de espera?',
      }),
    ).toBeInTheDocument()
  })
})
