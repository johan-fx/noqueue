import { NativePushProvider } from '@/platform/capacitor/NativePush'
import { NativeTurnGate } from '@/platform/capacitor/NativeTurnGate'
import { Outlet } from 'react-router'

export function NativeShell() {
  return <NativePushProvider>
    <div className="bg-background pt-[env(safe-area-inset-top,0px)] pl-[env(safe-area-inset-left,0px)] pr-[env(safe-area-inset-right,0px)] text-foreground [&_main]:min-h-[calc(100dvh-env(safe-area-inset-top))]">
      <NativeTurnGate><Outlet /></NativeTurnGate>
    </div>
  </NativePushProvider>
}
