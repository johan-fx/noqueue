import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Toast } from '@base-ui/react/toast'
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { QueueToastViewport } from './QueueToasts'

function ToastHarness() {
  const manager = Toast.useToastManager<{ title: string }>()
  return (
    <>
      <button
        type="button"
        onClick={() => {
          for (let i = 1; i <= 5; i++)
            manager.add({ title: `Notificación ${i}`, priority: 'low' })
        }}
      >
        Añadir cinco
      </button>
      <QueueToastViewport />
    </>
  )
}

function InlineToastHarness() {
  const manager = Toast.useToastManager<{ title: string }>()
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  return (
    <>
      <main>Contenido de la lista</main>
      <div
        ref={setContainer}
        data-testid="queue-toast-host"
        className="shrink-0"
      />
      <footer>
        <button type="button">Acción fija del footer</button>
      </footer>
      <QueueToastViewport container={container} />
      <button
        type="button"
        onClick={() => manager.add({ title: 'Turno asignado', priority: 'low' })}
      >
        Añadir notificación
      </button>
    </>
  )
}

function SessionToastHarness() {
  const manager = Toast.useToastManager<{ queueSessionId: string }>()
  const [sessionId, setSessionId] = useState('queue-a:1')
  return (
    <>
      <button
        type="button"
        onClick={() =>
          manager.add({
            title: 'Notificación de A',
            data: { queueSessionId: 'queue-a:1' },
            priority: 'low',
          })
        }
      >
        Añadir A
      </button>
      <button type="button" onClick={() => setSessionId('queue-b:2')}>
        Cambiar de sesión
      </button>
      <button
        type="button"
        onClick={() =>
          manager.add({
            title: 'Notificación de B',
            data: { queueSessionId: 'queue-b:2' },
            priority: 'low',
          })
        }
      >
        Añadir B
      </button>
      <QueueToastViewport sessionId={sessionId} />
    </>
  )
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

it('keeps at most three polite, non-focus-stealing toasts visible and dismisses them after five seconds', async () => {
  vi.useFakeTimers()
  render(
    <Toast.Provider timeout={5000} limit={3}>
      <ToastHarness />
    </Toast.Provider>,
  )
  const addButton = screen.getByRole('button', { name: 'Añadir cinco' })

  addButton.focus()
  fireEvent.click(addButton)

  expect(screen.getAllByRole('dialog')).toHaveLength(3)
  expect(screen.getByRole('region', { name: 'Notifications' })).toHaveAttribute(
    'aria-live',
    'polite',
  )
  expect(document.activeElement).toBe(addButton)

  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000)
  })
  expect(screen.queryAllByRole('dialog')).toHaveLength(0)
})

it('renders queue feedback in the reserved row before the sticky footer, not over controls', () => {
  render(
    <Toast.Provider timeout={5000} limit={3}>
      <InlineToastHarness />
    </Toast.Provider>,
  )

  const host = screen.getByTestId('queue-toast-host')
  // No feedback yet: the reserved row must not occupy space above the footer.
  expect(host).toBeEmptyDOMElement()

  fireEvent.click(screen.getByRole('button', { name: 'Añadir notificación' }))
  const toast = host.querySelector('[role="dialog"]')
  const footerAction = screen.getByRole('button', { name: 'Acción fija del footer' })
  expect(toast).toBeInTheDocument()
  expect(host.querySelector('[role="region"]')).not.toHaveClass('fixed')
  expect(
    host.compareDocumentPosition(footerAction) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy()
})

it('only renders feedback scoped to the active queue-view session', () => {
  render(
    <Toast.Provider timeout={5000} limit={3}>
      <SessionToastHarness />
    </Toast.Provider>,
  )

  fireEvent.click(screen.getByRole('button', { name: 'Añadir A' }))
  expect(screen.getByText('Notificación de A')).toBeVisible()

  fireEvent.click(screen.getByRole('button', { name: 'Cambiar de sesión' }))
  expect(screen.queryByText('Notificación de A')).not.toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'Añadir B' }))
  expect(screen.getByText('Notificación de B')).toBeVisible()
  expect(screen.queryByText('Notificación de A')).not.toBeInTheDocument()
})
