import { Outlet } from 'react-router'

export function WebShell() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b bg-card px-4 py-3">
        <p className="mx-auto max-w-3xl text-sm font-medium">No Queue · Web</p>
      </header>
      <main className="mx-auto max-w-3xl p-4">
        <Outlet />
      </main>
    </div>
  )
}
