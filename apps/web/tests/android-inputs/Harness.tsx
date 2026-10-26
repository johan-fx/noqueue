// Isolated real wizard: no API, credentials, notifications, or staging writes.
import { useState } from 'react'
import { ServiceConfigDrawer } from '../../src/features/staff/ServiceConfigDrawer'
import { emptyService } from '../../src/features/staff/service-config/model'
import { Button } from '../../src/components/ui/button'
import { ServiceForm } from '../../src/features/staff/ServiceForm'
import { QueueAdvancedDrawer } from '../../src/features/staff/QueueAdvancedDrawer'
import { QueueConfigDrawer } from '../../src/features/staff/service-config/QueueConfigDrawer'
import type { GroupedServiceInput, QueueSummary, ServiceInput } from '@noqueue/contracts/staff'

const seed: GroupedServiceInput = {
  ...emptyService,
  name: 'Snack bar',
  scheduleGroups: [{ days: [1, 2, 3, 4, 5, 6, 0], twentyFourHours: false, ranges: [{ from: '12:00', to: '23:00' }] }],
}
export function Harness() {
  const [open, setOpen] = useState(true)
  const [saved, setSaved] = useState<ServiceInput>(() => JSON.parse(localStorage.getItem('android-inputs-service') ?? 'null') ?? seed)
  const mode = new URLSearchParams(location.search).get('mode')
  const save = (value: ServiceInput) => { localStorage.setItem('android-inputs-service', JSON.stringify(value)); setSaved(value); setOpen(false) }
  if (mode === 'legacy') return <main className="p-6"><ServiceForm initial={{ ...emptyService, scheduleGroups: undefined, twentyFourHours: false, schedules: [{ day: 1, from: '12:00', to: '23:00' }], name: 'Snack bar' }} onSave={save} /><output hidden data-testid="saved">{JSON.stringify(saved)}</output></main>
  if (mode === 'queue') return <><QueueConfigDrawer open={open} type="restaurant" capacity={20} spaces={[{ id: 'main', name: 'Interior', tables: 1, tableTypes: [{ seats: 4, count: 1, averageMinutes: 30 }] }]} averageMinutes={30} queueBySeat={undefined} onOpenChange={setOpen} onConfirm={(spaces) => save({ ...seed, spaces })} /><output hidden data-testid="saved">{JSON.stringify(saved)}</output></>
  if (mode === 'reminder') {
    const queue: QueueSummary = { id: 'qa-local', venueId: 'qa-local', name: 'Snack bar', capacity: 20, averageMinutes: 60, version: 1, open: 0, serviceOpen: true, queueState: 'inactive', config: { ...seed, scheduleGroups: [{ days: [1], twentyFourHours: true, ranges: [] }, { days: [2], twentyFourHours: false, ranges: [{ from: '12:00', to: '23:00' }] }], reminder: { enabled: true, dailyAt: '12:00', intervals: [{ day: 2, from: '12:00', to: '23:00', at: '14:00' }] } } }
    return <QueueAdvancedDrawer queue={queue} canOperate canConfigure returnFocus={null} onClose={() => setOpen(false)} onSaved={() => setOpen(false)} />
  }
  return <>
    <main className="p-6"><h1>Prueba local Android · sin conexión al servidor</h1><Button onClick={() => setOpen(true)}>Editar servicio</Button><pre data-testid="saved">{JSON.stringify(saved, null, 2)}</pre></main>
    <ServiceConfigDrawer open={open} mode="edit" initial={saved} onClose={() => setOpen(false)} onSave={value => { localStorage.setItem('android-inputs-service', JSON.stringify(value)); setSaved(value); setOpen(false) }} />
  </>
}

