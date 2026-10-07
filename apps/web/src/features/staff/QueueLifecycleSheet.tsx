import { useEffect, useRef, useState } from 'react'
import type {
  QueueLifecycleCommand,
  QueueOpeningContext,
  ServiceInput,
} from '@noqueue/contracts/staff'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldLabel } from '@/components/ui/field'
import { api, ApiError, errorMessage } from './api'
import { readinessMessages } from './queue-readiness'
const groupKey = (g: { spaceId: string; seats: number }) =>
  JSON.stringify([g.spaceId, g.seats])
export function QueueLifecycleSheet({
  queueId,
  name,
  action,
  type = 'restaurant',
  onClose,
  onSaved,
  returnFocus,
}: {
  queueId: string
  name: string
  action: QueueLifecycleCommand['action']
  type?: ServiceInput['type']
  onClose: () => void
  onSaved: () => void | Promise<void>
  returnFocus?: HTMLElement | null
}) {
  const [context, setContext] = useState<QueueOpeningContext | null>(null)
  const [counts, setCounts] = useState<Record<string, string>>({})
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [selected, setSelected] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const saving = useRef(false)
  const request = useRef<{ payload: string; key: string } | null>(null)
  function receive(value: QueueOpeningContext) {
    setContext(value)
    setSelected(
      action === 'release_unit' && value.groups[0]
        ? groupKey(value.groups[0])
        : value.groups[0]?.spaceId ?? '',
    )
    setCounts(
      action === 'occupancy'
        ? Object.fromEntries(
            value.groups
              .filter((g) => value.inventoryConfirmed || g.occupied > 0)
              .map((g) => [groupKey(g), String(g.occupied)]),
          )
        : {},
    )
    setReasons({})
  }
  useEffect(() => {
    let live = true
    api<QueueOpeningContext>(`/queues/${queueId}/opening-context`)
      .then((value) => {
        if (live) receive(value)
      })
      .catch((e) => {
        if (live) setError(errorMessage(e))
      })
    return () => {
      live = false
    }
    // The component is mounted for one queue/action; a fresh opening never inherits a draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queueId, action])
  async function submit(body: QueueLifecycleCommand) {
    if (saving.current) return
    saving.current = true
    setBusy(true)
    setError('')
    const payload = JSON.stringify(body)
    if (request.current?.payload !== payload)
      request.current = { payload, key: crypto.randomUUID() }
    try {
      await api(
        `/queues/${queueId}/lifecycle`,
        'POST',
        body,
        request.current.key,
      )
      // A committed mutation must never be offered again because its refresh failed.
      onClose()
      await onSaved()
    } catch (e) {
      setError(errorMessage(e))
      if (e instanceof ApiError && e.status === 409) {
        request.current = null
        try {
          receive(
            await api<QueueOpeningContext>(
              `/queues/${queueId}/opening-context`,
            ),
          )
          setError(
            'La lista ha cambiado. Revisa los datos actualizados y vuelve a confirmar.',
          )
        } catch (refreshError) {
          setContext(null)
          setError(errorMessage(refreshError))
        }
      }
    } finally {
      saving.current = false
      setBusy(false)
    }
  }
  const valid = (g: QueueOpeningContext['groups'][number]) => {
    const value = counts[groupKey(g)]
    return (
      value !== undefined &&
      value.trim() !== '' &&
      Number.isInteger(Number(value)) &&
      Number(value) >= 0 &&
      Number(value) <= g.count - g.allocated
    )
  }
  const spaces = [
    ...new Map(context?.groups.map((g) => [g.spaceId, g.spaceName])).entries(),
  ]
  const policyChange =
    action === 'disable_intelligence' || action === 'enable_intelligence'
  const title =
    action === 'disable_intelligence'
      ? 'Desactivar gestión inteligente'
      : action === 'enable_intelligence'
      ? 'Volver a gestión automática'
      : action === 'open'
      ? 'Abrir lista'
      : action === 'close'
      ? 'Cerrar lista'
      : action === 'confirm_inventory'
      ? 'Confirmar ocupación'
      : 'Actualizar ocupación'
  const simpleAction =
    action === 'declare_full' ||
    action === 'pause' ||
    action === 'resume' ||
    action === 'release_unit' ||
    action === 'dismiss_reminder'
  if (simpleAction) {
    const chosen =
      context?.groups.find((g) => groupKey(g) === selected) ??
      context?.groups[0]
    const label =
      action === 'declare_full'
        ? 'Activar lista'
        : action === 'release_unit'
        ? 'Liberar una mesa'
        : action === 'pause'
        ? 'Pausar lista'
        : action === 'resume'
        ? 'Reanudar lista'
        : 'Ahora no'
    return (
      <Sheet
        open
        onOpenChange={(open) => {
          if (!open && !saving.current) onClose()
        }}
      >
        <SheetContent
          side="bottom"
          showCloseButton={false}
          finalFocus={() => returnFocus ?? null}
          className="mx-auto max-h-[85dvh] w-full rounded-t-xl sm:max-w-xl"
        >
          <SheetHeader>
            <SheetTitle>
              {action === 'release_unit' ? 'Mesa libre' : label} · {name}
            </SheetTitle>
            <SheetDescription>
              {action === 'declare_full'
                ? 'Se conservarán las mesas asignadas y se marcarán como ocupadas las restantes. No se supondrá cuándo estarán libres.'
                : action === 'release_unit'
                ? 'Libera una mesa ocupada fuera de la lista. Las mesas asignadas a turnos se mantienen.'
                : 'Se conservan los turnos y la ocupación actuales.'}
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-4 overflow-y-auto p-4" aria-busy={busy}>
            {!context && !error && <p role="status">Cargando estado actual…</p>}
            {error && <p role="alert">{error}</p>}
            {action === 'release_unit' &&
              context &&
              context.groups.length > 1 && (
                <Field>
                  <FieldLabel htmlFor="release-group">
                    Grupo de mesas
                  </FieldLabel>
                  <select
                    id="release-group"
                    className="h-12 w-full rounded-md border px-3"
                    value={selected}
                    disabled={busy}
                    onChange={(e) => setSelected(e.target.value)}
                  >
                    {context.groups.map((g) => (
                      <option key={groupKey(g)} value={groupKey(g)}>
                        {g.spaceName} · {g.seats} plazas
                      </option>
                    ))}
                  </select>
                </Field>
              )}
            {action === 'declare_full' &&
              context?.readiness.reasons.includes('configuration_missing') && (
                <p>
                  Completa los recursos en Configuración avanzada antes de
                  activar la lista.
                </p>
              )}
          </div>
          <SheetFooter className="border-t pb-[max(1rem,env(safe-area-inset-bottom))]">
            <Button
              disabled={
                busy ||
                !context ||
                (action === 'release_unit' &&
                  (!chosen || chosen.occupied < 1)) ||
                (action === 'declare_full' &&
                  (!context.serviceOpen ||
                    context.blockReason === 'cutoff' ||
                    context.readiness.reasons.includes(
                      'configuration_missing',
                    )))
              }
              onClick={() => {
                if (!context) return
                if (action === 'release_unit') {
                  if (chosen)
                    void submit({
                      action,
                      contextToken: context.contextToken,
                      spaceId: chosen.spaceId,
                      seats: chosen.seats,
                    })
                } else
                  void submit({ action, contextToken: context.contextToken })
              }}
            >
              {busy ? 'Guardando…' : label}
            </Button>
            <Button variant="outline" disabled={busy} onClick={onClose}>
              Cancelar
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    )
  }
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open && !saving.current) onClose()
      }}
    >
      <SheetContent
        side="bottom"
        showCloseButton={false}
        finalFocus={() => returnFocus ?? null}
        className="mx-auto max-h-[90dvh] w-full rounded-t-xl sm:max-w-xl"
      >
        <SheetHeader className="shrink-0">
          <SheetTitle>
            {title} · {name}
          </SheetTitle>
          <SheetDescription>
            {policyChange
              ? 'Los turnos y la ocupación se mantienen. Desactivar solo cambia el orden inteligente; la capacidad real sigue protegida. Al volver a automático se comprobarán la configuración y el inventario.'
              : action === 'close'
              ? 'Se impedirán nuevas inscripciones. Los turnos existentes permanecen y las mesas no se liberan.'
              : 'Indica la ocupación que no está asignada a turnos de la lista. Los recursos ya reservados se mantienen.'}
          </SheetDescription>
        </SheetHeader>
        <div
          className="min-h-0 overflow-y-auto px-4"
          aria-busy={!context || busy}
        >
          {error && (
            <p role="alert" className="mb-4 text-destructive">
              {error}
            </p>
          )}
          {!context && !error && <p role="status">Cargando estado actual…</p>}
          {context && action === 'close' && (
            <p>
              {context.pendingCount} turnos pendientes. Podrás seguir
              atendiéndolos con la lista cerrada.
            </p>
          )}
          {context && action !== 'close' && !policyChange && (
            <>
              {action === 'occupancy' && !context.inventoryConfirmed && (
                <p className="mb-3 text-sm">
                  Puedes corregir o liberar la ocupación registrada. Esto no
                  confirma el inventario completo ni abre la lista.
                </p>
              )}
              {context.readiness.reasons
                .filter((reason) => reason !== 'inventory_required')
                .map((reason) => (
                  <p
                    key={reason}
                    className="mb-3 text-sm text-muted-foreground"
                  >
                    {readinessMessages[reason]}
                  </p>
                ))}
              {(action === 'open' || action === 'confirm_inventory') && (
                <p className="mb-4 text-sm">
                  Confirma cada grupo, también si hay 0 ocupados. La estimación
                  será provisional cuando no conozcamos la hora de liberación.
                </p>
              )}
              {(action === 'open' || action === 'confirm_inventory') &&
                context.groups.length > 0 && (
                  <Button
                    variant="outline"
                    className="mb-4 whitespace-normal"
                    disabled={busy}
                    onClick={() =>
                      setCounts(
                        Object.fromEntries(
                          context.groups.map((g) => [groupKey(g), '0']),
                        ),
                      )
                    }
                  >
                    {type === 'restaurant'
                      ? 'Todas las mesas restantes están libres'
                      : 'Todos los recursos restantes están libres'}
                  </Button>
                )}
              <Tabs
                value={selected}
                onValueChange={(value) => setSelected(String(value))}
                className="min-w-0 gap-6"
              >
                <div className="min-w-0 overflow-x-auto py-1">
                  <TabsList
                    aria-label="Espacios"
                    className="w-full min-w-max group-data-horizontal/tabs:h-12"
                  >
                    {spaces.map(([id, label]) => (
                      <TabsTrigger key={id} value={id}>
                        {label}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </div>
                {spaces.map(([spaceId]) => (
                  <TabsContent key={spaceId} value={spaceId}>
                    <Accordion key={selected} className="gap-4">
                      {context.groups
                        .filter((g) => g.spaceId === spaceId)
                        .map((g) => {
                          const key = groupKey(g)
                          return (
                            <AccordionItem
                              key={key}
                              value={key}
                              className="border-0"
                            >
                              <AccordionTrigger className="hover:no-underline **:data-[slot=accordion-trigger-icon]:size-6">
                                <span className="text-lg font-medium">
                                  {type === 'reception'
                                    ? 'Puestos de atención'
                                    : `${
                                        type === 'restaurant'
                                          ? 'Mesas'
                                          : 'Grupos'
                                      } de ${g.seats}`}{' '}
                                  {(action === 'open' ||
                                    action === 'confirm_inventory') &&
                                    valid(g) && (
                                      <span className="text-sm text-muted-foreground">
                                        · Confirmado
                                      </span>
                                    )}
                                </span>
                              </AccordionTrigger>
                              <AccordionContent className="mt-3 space-y-4 rounded-lg border px-4 py-4">
                                <p>
                                  {g.count} en total · {g.allocated} asignados a
                                  la lista · {g.count - g.allocated} restantes
                                </p>
                                <Field>
                                  <FieldLabel
                                    htmlFor={`occupancy-${spaceId}-${g.seats}`}
                                  >
                                    Ocupados fuera de la lista
                                  </FieldLabel>
                                  <Input
                                    id={`occupancy-${spaceId}-${g.seats}`}
                                    aria-label={`${g.spaceName} · ${g.seats} plazas ocupadas fuera de la lista`}
                                    type="number"
                                    inputMode="numeric"
                                    min={0}
                                    max={g.count - g.allocated}
                                    step={1}
                                    required
                                    disabled={busy}
                                    value={counts[key] ?? ''}
                                    onChange={(e) =>
                                      setCounts({
                                        ...counts,
                                        [key]: e.target.value,
                                      })
                                    }
                                  />
                                </Field>
                                {action === 'occupancy' && (
                                  <>
                                    <Button
                                      variant="outline"
                                      disabled={
                                        busy ||
                                        !valid(g) ||
                                        Number(counts[key]) === 0
                                      }
                                      onClick={() => {
                                        setCounts({
                                          ...counts,
                                          [key]: String(
                                            Number(counts[key]) - 1,
                                          ),
                                        })
                                        setReasons({
                                          ...reasons,
                                          [key]: 'Liberación de recurso',
                                        })
                                      }}
                                    >
                                      Liberar uno
                                    </Button>
                                    <Field>
                                      <FieldLabel
                                        htmlFor={`reason-${spaceId}-${g.seats}`}
                                      >
                                        Motivo de la corrección o liberación
                                      </FieldLabel>
                                      <Input
                                        id={`reason-${spaceId}-${g.seats}`}
                                        disabled={busy}
                                        value={reasons[key] ?? ''}
                                        minLength={3}
                                        maxLength={300}
                                        onChange={(e) =>
                                          setReasons({
                                            ...reasons,
                                            [key]: e.target.value,
                                          })
                                        }
                                      />
                                    </Field>
                                    <Button
                                      disabled={
                                        busy ||
                                        !valid(g) ||
                                        (reasons[key]?.trim().length ?? 0) < 3
                                      }
                                      onClick={() =>
                                        void submit({
                                          action: 'occupancy',
                                          contextToken: context.contextToken,
                                          group: {
                                            spaceId: g.spaceId,
                                            seats: g.seats,
                                            occupied: Number(counts[key]),
                                          },
                                          reason: reasons[key]!,
                                        })
                                      }
                                    >
                                      Guardar cambio
                                    </Button>
                                  </>
                                )}
                              </AccordionContent>
                            </AccordionItem>
                          )
                        })}
                    </Accordion>
                  </TabsContent>
                ))}
              </Tabs>
            </>
          )}
        </div>
        <SheetFooter className="shrink-0 border-t pb-[max(1rem,env(safe-area-inset-bottom))]">
          {action !== 'occupancy' && (
            <Button
              disabled={
                busy ||
                !context ||
                (action === 'open' &&
                  (context.open || !context.groups.every(valid))) ||
                (action === 'confirm_inventory' &&
                  (context.inventoryConfirmed ||
                    context.readiness.reasons.includes(
                      'configuration_missing',
                    ) ||
                    !context.groups.every(valid))) ||
                (action === 'close' && !context.open)
              }
              onClick={() => {
                if (context)
                  void submit(
                    action === 'close' ||
                      action === 'disable_intelligence' ||
                      action === 'enable_intelligence'
                      ? { action, contextToken: context.contextToken }
                      : {
                          action,
                          contextToken: context.contextToken,
                          groups: context.groups.map((g) => ({
                            spaceId: g.spaceId,
                            seats: g.seats,
                            occupied: Number(counts[groupKey(g)]),
                          })),
                        },
                  )
              }}
            >
              {busy ? 'Guardando…' : title}
            </Button>
          )}
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancelar
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
