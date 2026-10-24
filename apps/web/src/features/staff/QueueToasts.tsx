import { Toast } from '@base-ui/react/toast'
import {
  CircleAlert,
  CircleCheck,
} from 'lucide-react'

export type QueueToastData = { queueSessionId: string }

export function QueueToastViewport({
  container,
  sessionId,
}: {
  /**
   * When supplied, place toasts in the queue drawer's reserved row above its
   * sticky footer rather than overlaying the list header or action controls.
   * Omit for standalone stories/tests that need the safe-area viewport.
   */
  container?: HTMLElement | null
  /**
   * Limits visible feedback to one opening of one queue drawer. `null` means
   * the queue view is hidden; `undefined` keeps standalone previews unscoped.
   */
  sessionId?: string | null
} = {}) {
  const { toasts } = Toast.useToastManager<QueueToastData>()
  const inline = container !== undefined
  // Base UI retains older limited toasts so they can animate out. Omit them
  // from the viewport markup as well, ensuring no more than three are visible.
  const visibleToasts = toasts.filter(
    (toast) =>
      !toast.limited &&
      (sessionId === undefined || toast.data?.queueSessionId === sessionId),
  )

  // The inline region sits in the document flow, above the sticky footer.
  // Its padding still takes 16px when it has no toasts, so the list stops
  // short and leaves a blank strip. Mount it only while feedback is visible.
  if ((inline && !container) || sessionId === null || (inline && visibleToasts.length === 0)) {
    return null
  }

  return (
    <Toast.Portal {...(inline ? { container } : {})}>
      <Toast.Viewport
        className={
          inline
            ? 'relative z-[100] mx-auto flex w-full max-w-md flex-col gap-2 px-4 py-2 outline-none'
            : 'fixed inset-x-0 bottom-0 z-[100] mx-auto flex w-full max-w-md flex-col gap-2 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] outline-none'
        }
      >
        {visibleToasts.map((toast) => {
          const Icon =
            toast.type === 'cancel' || toast.type === 'expiry'
              ? CircleAlert
              : CircleCheck
          return (
            <Toast.Root
              key={toast.id}
              toast={toast}
              className="pointer-events-auto flex items-center gap-2 rounded-lg border border-white/10 bg-[#262626] p-4 text-sm font-medium leading-5 text-white shadow-sm outline-none data-ending-style:translate-y-[-0.5rem] data-ending-style:opacity-0 data-starting-style:translate-y-[-0.5rem] data-starting-style:opacity-0"
            >
              <Icon className="size-5 shrink-0" aria-hidden="true" />
              <Toast.Content className="min-w-0 flex-1">
                <Toast.Title className="text-sm font-medium leading-5">
                  {toast.title}
                </Toast.Title>
              </Toast.Content>
            </Toast.Root>
          )
        })}
      </Toast.Viewport>
    </Toast.Portal>
  )
}
