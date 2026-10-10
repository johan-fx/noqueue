import { useImperativeHandle, useRef, type Ref } from 'react'
import { CheckIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { Tooltip } from '@base-ui/react/tooltip'
import {
  scheduleGroupSchema,
  type ScheduleGroup,
} from '@noqueue/contracts/staff'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Field, FieldLabel } from '@/components/ui/field'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { TimeInput } from '@/components/shadcn-studio/date-picker/date-picker-09'
import { formatCompactDays, weekdays } from './hours'

import type {
  DraftGroup,
  ScheduleEditorState,
  ScheduleEditorHandle,
} from './schedule-editor-state'

function groupErrors(group: ScheduleGroup): string[] {
  const result = scheduleGroupSchema.safeParse({
    ...group,
    ranges: group.twentyFourHours ? [] : group.ranges,
  })
  if (result.success) return []
  return [
    ...new Set(
      result.error.issues.map((issue) => {
        if (issue.path[0] === 'days') return 'Selecciona al menos un día'
        if (issue.message === 'Overlapping hours')
          return 'Las franjas se solapan'
        if (issue.message === 'Use separate ranges for overnight hours')
          return 'El horario no puede pasar de medianoche'
        return 'Indica una hora válida en cada franja'
      }),
    ),
  ]
}
function IconAction({
  label,
  children,
  ...props
}: React.ComponentProps<typeof Button> & { label: string }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={label}
            {...props}
          />
        }
      >
        {children}
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Positioner sideOffset={6}>
          <Tooltip.Popup className="z-[100] rounded-md bg-foreground px-2 py-1 text-xs text-background">
            {label}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}
export function ScheduleGroupsEditor({
  state,
  onChange,
  editorRef,
}: {
  state: ScheduleEditorState
  onChange: (next: ScheduleEditorState) => void
  editorRef: Ref<ScheduleEditorHandle>
}) {
  const root = useRef<HTMLDivElement>(null)
  function focus(key: string, target: 'edit' | 'days' = 'edit') {
    queueMicrotask(() =>
      root.current
        ?.querySelector<HTMLButtonElement>(
          `[data-group-${target}="${key}"]:not(:disabled)`,
        )
        ?.focus(),
    )
  }
  function confirmActive(): ScheduleEditorState | null {
    const active = state.groups.find((group) => group.key === state.activeKey)
    if (!active) return state
    const errors = groupErrors(active)
    const expandedCount = state.groups.reduce(
      (total, group) =>
        total +
        (group.twentyFourHours ? 0 : group.days.length * group.ranges.length),
      0,
    )
    if (expandedCount > 28)
      errors.push('No puedes superar 28 franjas al contar todos los días')
    if (errors.length) {
      onChange({ ...state, errors: { ...state.errors, [active.key]: errors } })
      focus(active.key, 'days')
      return null
    }
    return {
      ...state,
      activeKey: null,
      groups: state.groups.map((group) =>
        group.key === active.key ? { ...group, confirmed: true } : group,
      ),
      errors: {},
    }
  }
  useImperativeHandle(editorRef, () => ({
    confirm() {
      const next = confirmActive()
      if (!next) return false
      const invalid = next.groups.find((group) => groupErrors(group).length)
      if (invalid) {
        onChange({
          ...next,
          activeKey: invalid.key,
          errors: { [invalid.key]: groupErrors(invalid) },
        })
        focus(invalid.key, 'days')
        return false
      }
      onChange(next)
      return true
    },
  }))
  function update(key: string, change: Partial<ScheduleGroup>) {
    onChange({
      ...state,
      groups: state.groups.map((group) =>
        group.key === key ? { ...group, ...change } : group,
      ),
      errors: {},
    })
  }
  const reserved = new Set(state.groups.flatMap((group) => group.days))
  return (
    <Tooltip.Provider>
      <div ref={root} className="space-y-2">
        <h3 className="text-sm font-medium">Días y horarios de apertura</h3>
        {state.groups.map((group, index) => {
          const expanded = state.activeKey === group.key
          const unavailable = new Set(
            state.groups
              .filter((item) => item.key !== group.key)
              .flatMap((item) => item.days),
          )
          const errors = state.errors[group.key] ?? []
          const title = `Horario ${index + 1}`
          return (
            <Card
              key={group.key}
              role="region"
              aria-label={title}
              className={`rounded-[6px] border border-[#e0e0e0] ring-0 ${
                expanded ? 'gap-2 p-3' : 'gap-1 px-3 py-2'
              }`}
            >
              {expanded ? (
                <div className="relative flex min-h-5 items-center justify-between gap-2">
                  <h4 className="text-sm font-medium">{title}</h4>
                  <div className="absolute -top-1.5 right-0 flex items-center gap-1">
                    {group.confirmed ? (
                      <IconAction
                        label={`Confirmar horario ${index + 1}`}
                        onClick={() => {
                          const next = confirmActive()
                          if (next) {
                            onChange(next)
                            focus(group.key)
                          }
                        }}
                      >
                        <CheckIcon aria-hidden="true" />
                      </IconAction>
                    ) : (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          const next = confirmActive()
                          if (next) {
                            onChange(next)
                            focus(group.key)
                          }
                        }}
                      >
                        Listo
                      </Button>
                    )}
                    {(group.confirmed || state.groups.length > 1) && (
                      <IconAction
                        label={`Eliminar horario ${index + 1}`}
                        disabled={state.groups.length === 1}
                        onClick={() => {
                          const groups = state.groups.filter(
                            (item) => item.key !== group.key,
                          )
                          onChange({ groups, activeKey: null, errors: {} })
                          focus(groups[Math.min(index, groups.length - 1)]!.key)
                        }}
                      >
                        <Trash2Icon aria-hidden="true" />
                      </IconAction>
                    )}
                  </div>
                </div>
              ) : (
                // Title and hours form one block; Editar is centered on that block.
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <h4 className="text-sm font-medium leading-5">{title}</h4>
                    <p className="text-sm leading-5 text-foreground">
                      {formatCompactDays(group.days)} ·{' '}
                      {group.twentyFourHours
                        ? 'Abierto 24 horas'
                        : group.ranges
                            .map((range) => `${range.from}–${range.to}`)
                            .join(', ')}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-11 shrink-0 px-2 font-normal"
                    aria-label={`Editar horario ${index + 1}`}
                    data-group-edit={group.key}
                    onClick={() => {
                      const next = confirmActive()
                      if (next) {
                        onChange({ ...next, activeKey: group.key })
                        focus(group.key, 'days')
                      }
                    }}
                  >
                    Editar
                  </Button>
                </div>
              )}
              {expanded && (
                <>
                  <Field data-invalid={errors.length > 0 || undefined}>
                    <ToggleGroup
                      multiple
                      variant="outline"
                      spacing={2}
                      aria-label={`Días de ${title.toLowerCase()}`}
                      aria-invalid={
                        (errors.length > 0 && !group.days.length) || undefined
                      }
                      aria-describedby={
                        errors.length
                          ? `schedule-errors-${group.key}`
                          : undefined
                      }
                      className="grid w-full grid-cols-7 pt-2"
                      value={group.days.map(String)}
                      onValueChange={(next) =>
                        update(group.key, { days: next.map(Number) })
                      }
                    >
                      {weekdays.map((weekday) => (
                        <ToggleGroupItem
                          key={weekday.day}
                          value={String(weekday.day)}
                          aria-label={weekday.label}
                          data-group-days={group.key}
                          disabled={unavailable.has(weekday.day)}
                          className="h-10 min-w-0 w-full rounded-lg border-[#e0e0e0] bg-white p-0 text-[#1f1f1f] data-pressed:border-[#2e2e2e] data-pressed:bg-[#2e2e2e] data-pressed:text-white disabled:border-[#e0e0e0] disabled:bg-[#f2f2f2] disabled:text-[#a6a6a6] disabled:opacity-100"
                        >
                          {weekday.short}
                        </ToggleGroupItem>
                      ))}
                    </ToggleGroup>
                  </Field>
                  <Field orientation="horizontal" className="pt-5 pb-2">
                    <Switch
                      id={`all-day-${group.key}`}
                      checked={group.twentyFourHours}
                      onCheckedChange={(twentyFourHours) =>
                        update(group.key, { twentyFourHours })
                      }
                    />
                    <FieldLabel htmlFor={`all-day-${group.key}`}>
                      Abierto 24 horas
                    </FieldLabel>
                  </Field>
                  {!group.twentyFourHours && (
                    <div className="space-y-2 pt-2">
                      {group.ranges.map((range, rangeIndex) => (
                        <div key={rangeIndex} className="flex items-end gap-2">
                          <div className="grid min-w-0 flex-1 grid-cols-2 gap-2 [&_input]:h-11 [&_input]:text-center [&_label]:px-0">
                            <TimeInput
                              id={`from-${group.key}-${rangeIndex}`}
                              label="Desde"
                              showClock={false}
                              hideLabel={rangeIndex > 0}
                              aria-invalid={errors.length > 0 || undefined}
                              aria-describedby={
                                errors.length
                                  ? `schedule-errors-${group.key}`
                                  : undefined
                              }
                              value={range.from}
                              onChange={(from) =>
                                update(group.key, {
                                  ranges: group.ranges.map((item, i) =>
                                    i === rangeIndex ? { ...item, from } : item,
                                  ),
                                })
                              }
                            />
                            <TimeInput
                              id={`to-${group.key}-${rangeIndex}`}
                              label="Hasta"
                              showClock={false}
                              hideLabel={rangeIndex > 0}
                              aria-invalid={errors.length > 0 || undefined}
                              aria-describedby={
                                errors.length
                                  ? `schedule-errors-${group.key}`
                                  : undefined
                              }
                              value={range.to}
                              onChange={(to) =>
                                update(group.key, {
                                  ranges: group.ranges.map((item, i) =>
                                    i === rangeIndex ? { ...item, to } : item,
                                  ),
                                })
                              }
                            />
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="size-11 shrink-0"
                            aria-label={`Eliminar franja ${rangeIndex + 1}`}
                            disabled={group.ranges.length === 1}
                            onClick={() =>
                              update(group.key, {
                                ranges: group.ranges.filter(
                                  (_, i) => i !== rangeIndex,
                                ),
                              })
                            }
                          >
                            <Trash2Icon aria-hidden="true" className="size-4" />
                          </Button>
                        </div>
                      ))}
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-10 w-full"
                        onClick={() =>
                          update(group.key, {
                            ranges: [...group.ranges, { from: '', to: '' }],
                          })
                        }
                      >
                        <PlusIcon aria-hidden="true" className="size-4" />
                        Añadir franja
                      </Button>
                    </div>
                  )}
                  {!!errors.length && (
                    <p
                      role="alert"
                      id={`schedule-errors-${group.key}`}
                      className="text-sm text-destructive"
                    >
                      {errors.join('. ')}
                    </p>
                  )}
                </>
              )}
            </Card>
          )
        })}
        <Button
          type="button"
          variant="outline"
          className="h-11 w-full"
          disabled={reserved.size === 7 || state.groups.length === 7}
          onClick={() => {
            const next = confirmActive()
            if (!next) return
            const group: DraftGroup = {
              key: crypto.randomUUID(),
              confirmed: false,
              days: [],
              twentyFourHours: false,
              ranges: [{ from: '12:00', to: '23:00' }],
            }
            onChange({
              ...next,
              groups: [...next.groups, group],
              activeKey: group.key,
            })
            focus(group.key, 'days')
          }}
        >
          <PlusIcon aria-hidden="true" className="size-4" />
          Añadir horario diferente
        </Button>
      </div>
    </Tooltip.Provider>
  )
}
