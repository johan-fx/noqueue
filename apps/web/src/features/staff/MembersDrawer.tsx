import { useEffect, useRef, useState, type RefObject } from 'react'
import {
  inviteSchema,
  memberDetailsSchema,
  type StaffMember,
  type MemberDetailsInput,
  type membershipUpdateSchema,
} from '@noqueue/contracts/staff'
import type { z } from 'zod'
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerFooter,
} from '@/components/ui/drawer'
import { Button } from '@/components/ui/button'
import {
  MemberActionDrawer,
  type MemberAction,
  type MemberActionInput,
} from './MemberActionDrawer'
import { Members } from './Members'
import { api, errorMessage } from './api'
type Data = { members: StaffMember[] }
type CommittedChange =
  | {
      kind: 'membership'
      id: string
      input: z.infer<typeof membershipUpdateSchema>
    }
  | { kind: 'edit'; id: string; input: MemberDetailsInput }
  | { kind: 'create' | 'password' }
type Props = {
  open: boolean
  venueId: string
  name: string
  finalFocus?: RefObject<HTMLElement | null>
  onClose: () => void
}
export function MembersDrawer({
  open,
  venueId,
  name,
  finalFocus,
  onClose,
}: Props) {
  const canCloseRef = useRef(() => true)
  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        if (!next && canCloseRef.current()) onClose()
      }}
      swipeDirection="right"
    >
      <DrawerContent
        finalFocus={finalFocus}
        className="w-full sm:w-[48rem] sm:max-w-[calc(100vw-2rem)]"
      >
        <DrawerHeader className="border-b p-6">
          <DrawerTitle className="text-xl">Gestionar accesos</DrawerTitle>
          <DrawerDescription className="break-words">{name}</DrawerDescription>
        </DrawerHeader>
        {open && (
          <MemberManagement
            key={venueId}
            venueId={venueId}
            name={name}
            onClose={onClose}
            canCloseRef={canCloseRef}
          />
        )}
      </DrawerContent>
    </Drawer>
  )
}
function MemberManagement({
  venueId,
  name,
  onClose,
  canCloseRef,
}: {
  venueId: string
  name: string
  onClose: () => void
  canCloseRef: RefObject<() => boolean>
}) {
  const [members, setMembers] = useState<StaffMember[]>([]),
    [action, setAction] = useState<MemberAction | null>(null),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [needsReload, setNeedsReload] = useState(false)
  const lock = useRef(false),
    generation = useRef(0),
    trigger = useRef<HTMLElement | null>(null),
    reloadTriggerRef = useRef<HTMLButtonElement | null>(null),
    actionRef = useRef<MemberAction | null>(null)
  useEffect(() => {
    const current = ++generation.current,
      controller = new AbortController()
    canCloseRef.current = () => !lock.current && !actionRef.current
    void api<Data>(
      `/venues/${venueId}/members`,
      'GET',
      undefined,
      undefined,
      controller.signal,
    )
      .then((data) => {
        if (generation.current === current) setMembers(data.members)
      })
      .catch((e) => {
        if (generation.current === current) setError(errorMessage(e))
      })
      .finally(() => {
        if (generation.current === current) setLoading(false)
      })
    return () => {
      generation.current = current + 1
      canCloseRef.current = () => true
      controller.abort()
    }
  }, [venueId, canCloseRef])
  useEffect(() => {
    if (needsReload && !action && !busy) {
      const current = generation.current
      // The retry control mounts in the same commit that removes the child.
      // Run after the primitive's queued restoration to the disabled CTA.
      queueMicrotask(() => {
        if (generation.current === current)
          reloadTriggerRef.current?.focus({ preventScroll: true })
      })
    }
  }, [needsReload, action, busy])
  function closeChild() {
    if (!lock.current) {
      actionRef.current = null
      setAction(null)
      setError('')
    }
  }
  async function mutate(
    path: string,
    method: string,
    body: unknown,
    change: CommittedChange,
    closeAction = false,
  ) {
    if (lock.current || loading || needsReload) return
    lock.current = true
    setBusy(true)
    setError('')
    setNotice('')
    const current = generation.current
    try {
      await api(path, method, body)
      if (generation.current !== current) return
      // Reconcile only confirmed writes, before reading the list again. A failed
      // refresh must not offer an action based on the pre-save member snapshot.
      if (change.kind === 'membership')
        setMembers((rows) =>
          rows.map((member) =>
            member.id === change.id
              ? {
                  ...member,
                  ...change.input,
                  active: Number(change.input.active),
                }
              : member,
          ),
        )
      else if (change.kind === 'edit')
        setMembers((rows) =>
          rows.map((member) =>
            member.id === change.id ? { ...member, ...change.input } : member,
          ),
        )
      setNotice(
        'Operación guardada. Entrega las credenciales por un canal seguro.',
      )
      try {
        const data = await api<Data>(`/venues/${venueId}/members`)
        if (generation.current === current) {
          setMembers(data.members)
          setNeedsReload(false)
        }
      } catch (e) {
        if (generation.current === current) {
          if (change.kind === 'create') setNeedsReload(true)
          setError(
            `La operación se ha guardado, pero no se pudo actualizar el listado. ${errorMessage(
              e,
            )}`,
          )
        }
      }
      if (generation.current === current && closeAction) {
        actionRef.current = null
        setAction(null)
      }
    } catch (e) {
      if (generation.current === current) setError(errorMessage(e))
    } finally {
      if (generation.current === current) {
        lock.current = false
        setBusy(false)
      }
    }
  }
  async function submit(values: MemberActionInput) {
    if (!action) return
    const base = `/venues/${venueId}/members`
    if (action.kind === 'create') {
      const input = inviteSchema.parse(values)
      await mutate(base, 'POST', input, { kind: 'create' }, true)
    } else if (action.kind === 'edit') {
      const input = memberDetailsSchema.parse(values)
      await mutate(
        `${base}/${action.member.id}/details`,
        'PATCH',
        input,
        { kind: 'edit', id: action.member.id, input },
        true,
      )
    } else
      await mutate(
        `${base}/${action.member.id}/password`,
        'POST',
        values,
        { kind: 'password' },
        true,
      )
  }
  async function reload() {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    const current = generation.current
    try {
      const data = await api<Data>(`/venues/${venueId}/members`)
      if (generation.current === current) {
        setMembers(data.members)
        setNeedsReload(false)
        setError('')
      }
    } catch (e) {
      if (generation.current === current) setError(errorMessage(e))
    } finally {
      if (generation.current === current) {
        lock.current = false
        setBusy(false)
      }
    }
  }
  return (
    <>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-6">
        {!action && error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        {needsReload && (
          <>
            <p>Actualiza el listado antes de gestionar más usuarios.</p>
            <Button
              ref={reloadTriggerRef}
              variant="outline"
              disabled={busy}
              onClick={() => void reload()}
            >
              Actualizar listado
            </Button>
          </>
        )}
        <Members
          name={name}
          members={members}
          busy={busy || !!action || needsReload}
          loading={loading}
          actionOpen={!!action}
          trigger={trigger}
          onAction={(next, element) => {
            if (!lock.current) {
              trigger.current = element
              actionRef.current = next
              setError('')
              setAction(next)
            }
          }}
          onToggle={(member) => {
            if (member.role === 'owner' || needsReload) return
            const input = {
              role: member.role,
              active: !member.active,
            }
            void mutate(
              `/venues/${venueId}/members/${member.id}`,
              'PATCH',
              input,
              { kind: 'membership', id: member.id, input },
            )
          }}
        />
      </div>
      <DrawerFooter className="border-t bg-background p-6 sm:flex-row sm:justify-end">
        <Button
          variant="outline"
          disabled={busy || !!action}
          onClick={() => {
            if (!lock.current && !action) onClose()
          }}
        >
          Cerrar
        </Button>
      </DrawerFooter>
      {action && (
        <MemberActionDrawer
          key={`${action.kind}:${'member' in action ? action.member.id : ''}`}
          action={action}
          busy={busy}
          error={error}
          finalFocus={trigger}
          onClose={closeChild}
          onSubmit={submit}
        />
      )}
    </>
  )
}
