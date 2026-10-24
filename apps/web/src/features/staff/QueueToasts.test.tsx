import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

function OverlayToastHarness() {
  const manager = Toast.useToastManager<{ title: string }>()
  return (
    <>
      <main>Contenido de la lista</main>
      <footer>
        <button type="button">Acción fija del footer</button>
      </footer>
      <QueueToastViewport />
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
  const [sessionId, setSessionId] = useState<string | null>('queue-a:1')
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
      <button type="button" onClick={() => setSessionId(null)}>
        Ocultar cola
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
    await vi.advanceTimersByTimeAsync(4999)
  })
  expect(screen.getAllByRole('dialog')).toHaveLength(3)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1)
  })
  expect(screen.queryAllByRole('dialog')).toHaveLength(0)
})

it('portals feedback to a fixed bottom overlay without adding a row before the footer', () => {
  const { container } = render(
    <Toast.Provider timeout={5000} limit={3}>
      <OverlayToastHarness />
    </Toast.Provider>,
  )

  const footer = container.querySelector('footer')!
  const previousSibling = footer.previousElementSibling
  expect(previousSibling?.tagName).toBe('MAIN')
  expect(container.querySelector('[data-slot="toast-viewport"]')).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: 'Añadir notificación' }))
  const viewport = screen.getByRole('region', { name: 'Notifications' })
  // Queue feedback sits above its drawer (50), never above action sheets (60).
  expect(viewport).toHaveClass('fixed', 'pointer-events-none', 'z-[55]')
  expect(viewport.className).toContain('env(safe-area-inset-bottom)')
  expect(viewport).toHaveClass('inset-x-4', 'mx-auto', 'sm:inset-x-4', 'sm:mx-auto', 'sm:w-auto')
  expect(viewport).not.toHaveClass('sm:left-auto', 'sm:mx-0', 'sm:w-full')
  // Wide portrait tablets stay centered; only wide landscape screens align right.
  expect(viewport).toHaveClass('lg:landscape:left-auto', 'lg:landscape:right-4', 'lg:landscape:mx-0', 'lg:landscape:w-full')
  expect(viewport.parentElement).toHaveAttribute('data-slot', 'toast-portal')
  expect(viewport.parentElement?.parentElement).toBe(document.body)
  expect(container).not.toContainElement(viewport)
  expect(footer.previousElementSibling).toBe(previousSibling)
  expect(screen.getByText('Turno asignado').closest('[data-slot="toast"]'))
    .toHaveClass('absolute', 'bg-[#262626]', 'text-[#fafafa]', 'rounded-lg')

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

it('hides all feedback when the queue session closes', () => {
  render(
    <Toast.Provider timeout={5000} limit={3}>
      <SessionToastHarness />
    </Toast.Provider>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Añadir A' }))
  expect(screen.getByText('Notificación de A')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Ocultar cola' }))
  expect(screen.queryByText('Notificación de A')).not.toBeInTheDocument()
  expect(screen.queryByRole('region', { name: 'Notifications' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Cambiar de sesión' }))
  expect(screen.queryByText('Notificación de A')).not.toBeInTheDocument()
})

it('closes the focused toast with Escape and reflows the remaining stack', async () => {
  render(
    <Toast.Provider timeout={5000} limit={3}>
      <ToastHarness />
    </Toast.Provider>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Añadir cinco' }))
  expect(screen.getAllByRole('dialog').map((node) => node.textContent))
    .toEqual(['Notificación 5', 'Notificación 4', 'Notificación 3'])
  const newest = screen.getByRole('dialog', { name: 'Notificación 5' })
  act(() => newest.focus())
  fireEvent.keyDown(newest, { key: 'Escape' })
  await waitFor(() => expect(screen.queryByText('Notificación 5')).not.toBeInTheDocument())
  expect(screen.getAllByRole('dialog').map((node) => node.textContent))
    .toEqual(['Notificación 4', 'Notificación 3', 'Notificación 2'])
  // Closing one toast must not leave holes in the stack's positioning indices.
  expect(screen.getAllByRole('dialog').map((node) => node.style.getPropertyValue('--toast-index')))
    .toEqual(['0', '1', '2'])
})
