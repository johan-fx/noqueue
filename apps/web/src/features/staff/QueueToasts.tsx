import { CircleAlert } from 'lucide-react'
import successIcon from '@/assets/queue-toast/success.svg'
import {
  Toast,
  ToastContent,
  ToastPortal,
  ToastTitle,
  ToastViewport,
  useToastManager,
} from '@/components/ui/toast'

export type QueueToastData = { queueSessionId: string }

export function QueueToastViewport({
  sessionId,
}: {
  /**
   * Limits visible feedback to one opening of one queue drawer. `null` means
   * the queue view is hidden; `undefined` keeps standalone previews unscoped.
   */
  sessionId?: string | null
} = {}) {
  const { toasts } = useToastManager<QueueToastData>()
  // Do not render retained, limited toasts or feedback from an older opening.
  const visibleToasts = toasts.filter(
    (toast) =>
      !toast.limited &&
      (sessionId === undefined || toast.data?.queueSessionId === sessionId),
  )

  if (sessionId === null) return null

  return (
    // Escape the drawer's transformed/clipped popup without reserving space.
    // Base UI keeps nested portals inside the modal's outer portal for a11y.
    // Above the queue drawer (50), below action sheets/backdrops (60): a
    // hovered toast must never cover and indefinitely block confirmation.
    <ToastPortal>
      <ToastViewport className="bottom-[max(1rem,env(safe-area-inset-bottom))] z-[55] sm:inset-x-4 sm:mx-auto sm:w-auto lg:landscape:left-auto lg:landscape:right-4 lg:landscape:mx-0 lg:landscape:w-full">
        {visibleToasts.map((toast) => {
          const isAlert = toast.type === 'cancel' || toast.type === 'expiry'
          return (
            <Toast
              key={toast.id}
              toast={toast}
              className="rounded-lg border-white/10 bg-[#262626] font-sans text-[#fafafa] shadow-[0_4px_6px_rgba(0,0,0,0.1)]"
            >
              <ToastContent className="gap-2">
                {isAlert ? (
                  <CircleAlert className="size-5 shrink-0" aria-hidden="true" />
                ) : (
                  <img src={successIcon} alt="" width={20} height={20} className="shrink-0" />
                )}
                <ToastTitle className="min-w-0 flex-1 wrap-break-word text-sm font-medium leading-5">
                  {toast.title}
                </ToastTitle>
              </ToastContent>
            </Toast>
          )
        })}
      </ToastViewport>
    </ToastPortal>
  )
}
