import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { Drawer, DrawerContent } from '@/components/ui/drawer'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from './sheet'

afterEach(cleanup)

// Base UI skips the backdrop of nested dialogs unless forceRender is set.
// A sheet inside a drawer must still dim and blur everything behind it.
it('renders the overlay when the sheet is nested inside a drawer', async () => {
  render(
    <Drawer open>
      <DrawerContent>
        <Sheet open>
          <SheetContent side="bottom">
            <SheetTitle>Confirmar</SheetTitle>
            <SheetDescription>Detalle</SheetDescription>
          </SheetContent>
        </Sheet>
      </DrawerContent>
    </Drawer>,
  )
  await screen.findByRole('dialog', { name: 'Confirmar' })
  const overlay = document.querySelector('[data-slot="sheet-overlay"]')
  expect(overlay).toBeInTheDocument()
})
