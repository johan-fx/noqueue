import { Outlet } from 'react-router'

export function NativeShell() {
  return (
    <div className="min-h-screen bg-background pt-[env(safe-area-inset-top)] text-foreground">
      <header className="border-b bg-card px-4 py-3">
        <p className="mx-auto max-w-3xl text-sm font-medium">No Queue · App</p>
      </header>
      <main className="mx-auto max-w-3xl p-4 pb-[env(safe-area-inset-bottom)]">
        <Outlet />
      </main>
    </div>
  )
}
