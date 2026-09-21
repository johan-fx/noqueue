import { serviceSchema, type ServiceInput } from '@noqueue/contracts/staff'
import type { StepId } from './model'

const copy: Record<string, string> = {
  'Add opening hours': 'Añade un horario de apertura',
  'Overlapping hours': 'Las franjas se solapan',
  'Use separate ranges for overnight hours':
    'El horario no puede pasar de medianoche',
  'Add a space': 'Añade un espacio',
  'Select a reception service': 'Selecciona un servicio de recepción',
}

export type FieldIssue = { path: string; message: string }

function translated(path: string, message: string) {
  if (copy[message]) return copy[message]
  if (path === 'name') return 'Escribe un nombre de al menos 2 caracteres'
  return message
}

/** Issues that belong to the current step. Later steps are ignored. */
export function issuesFor(values: ServiceInput, step: StepId): FieldIssue[] {
  const parsed = serviceSchema.safeParse(values)
  const schemaIssues = parsed.success
    ? []
    : parsed.error.issues.map((issue) => ({
        path: String(issue.path[0] ?? 'form'),
        message: translated(String(issue.path[0] ?? 'form'), issue.message),
      }))
  const wanted = new Set(pathsFor(values, step))
  const current = schemaIssues.filter((issue) => wanted.has(issue.path))
  if (
    step === 'capacity' &&
    values.type !== 'reception' &&
    !values.spaces.length
  )
    current.push({ path: 'spaces', message: 'Añade un espacio' })
  if (
    step === 'capacity' &&
    values.type !== 'reception' &&
    values.spaces.some((space) => space.name.trim().length < 2 || space.tables < 1)
  )
    current.push({
      path: 'spaces',
      message: 'Cada espacio necesita nombre y al menos una plaza',
    })
  return current
}

function pathsFor(values: ServiceInput, step: StepId) {
  if (step === 'general') return ['name', 'schedules', 'cutoffMinutes']
  if (step === 'capacity')
    return values.type === 'reception' ? ['receptionServices'] : ['spaces']
  if (step === 'queue') return ['capacity', 'averageMinutes', 'graceMinutes']
  return []
}
