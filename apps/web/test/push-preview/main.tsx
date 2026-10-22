// Isolated visual fixture: production components, fictitious turn, simulated native state.
// Not imported by the application or included in release builds.
import React from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import '@fontsource-variable/geist'
import '@/index.css'
import type { Entry } from '@noqueue/contracts/queue'
import { CustomerShell } from '@/features/customer/shared'
import { TurnView } from '@/features/customer/TurnView'
import { NativePushProvider, NativePushControls } from '@/platform/capacitor/NativePush'

const locale = new URLSearchParams(location.search).get('lang') === 'en' ? 'en' : 'es'
const entry: Entry = {
  code: 'NQ24', position: 6, etaMinutes: 12, initialEtaMinutes: 30,
  predictedAt: 721000, estimateQuality: 'estimated', status: 'waiting', notification: 'disabled',
  customer: {
    service: { id: 'preview', name: 'Restaurante', venueId: 'demo', venueName: 'Hotel de prueba', type: 'restaurant', open: 1,
      receptionServices: [], spaces: [{ id: 'terrace', name: 'Terraza', maxPartySize: 8 }] },
    displayName: 'María', partySize: 2, preferredSpaceId: 'terrace', locale, version: 1,
    serverNow: 1000, createdAt: 0, calledAt: null, arrivalDeadlineAt: null, arrivedAt: null,
    phase: 'waiting', actions: ['update', 'cancel', 'yield'],
  },
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode><MemoryRouter><NativePushProvider hasActiveTurn>
    <CustomerShell title="Restaurante" locale={locale} setLocale={() => undefined}>
      <TurnView entry={entry} locale={locale} updatedAt={1000} now={1000} online joined={false} yielded={false}
        onAction={() => undefined} extra={<NativePushControls locale={locale} />} />
    </CustomerShell>
  </NativePushProvider></MemoryRouter></React.StrictMode>,
)
