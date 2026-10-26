import type { QueueAutomationAttention, StaffEntry } from '@noqueue/contracts/staff'
import { Sheet, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import warningIcon from '@/assets/queue-sheet/warning.svg'
import { QueueAssignmentCandidate, TurnSheetFrame } from './QueueTurnSheets'

export function QueueAutomationAttentionSheet({ attention, selectedId, candidates, clockOffsetMs, onSelectAttention, onSelectCandidate, onClose, returnFocus }: {
  attention: QueueAutomationAttention[]
  selectedId: string | null
  candidates: StaffEntry[]
  clockOffsetMs: number
  onSelectAttention: (id: string) => void
  onSelectCandidate: (entry: StaffEntry, attentionId: string) => void
  onClose: () => void
  returnFocus: () => HTMLElement | null
}) {
  const current = attention.find(item => item.id === selectedId)
  return <Sheet open={!!current} onOpenChange={open => { if (!open) onClose() }}>
    <TurnSheetFrame busy={false} warning returnFocus={returnFocus} footer={
      <Button variant="outline" className="h-12 w-full rounded-lg text-sm font-medium" onClick={onClose}>Ahora no</Button>
    }>
      {current && <div className="space-y-6">
        <SheetHeader className="gap-2 p-0">
          <SheetTitle className="pr-8 text-2xl font-medium leading-[1.4] text-[#374151]">No hay un turno compatible</SheetTitle>
          <SheetDescription className="text-sm leading-5 text-[#6b7280]">
            Ha vencido el plazo de llegada de <strong className="font-semibold">{current.entry.displayName || current.entry.code}</strong>.
          </SheetDescription>
          <p className="text-sm leading-5 text-[#6b7280]">La asignación automática de <strong className="font-semibold">{current.capacity} {current.capacity === 1 ? 'persona' : 'personas'} · {current.spaceName}</strong> se ha detenido.</p>
        </SheetHeader>
        {attention.length > 1 && <div className="space-y-2" role="group" aria-label="Asignaciones pendientes de revisión">
          <p className="text-sm text-muted-foreground">{attention.length} asignaciones requieren revisión</p>
          <div className="flex flex-wrap gap-2">{attention.map(item => <Button key={item.id} variant="outline" size="sm" aria-pressed={item.id === current.id} onClick={() => onSelectAttention(item.id)}>
            {item.entry.displayName || item.entry.code} · {item.capacity}
          </Button>)}</div>
        </div>}
        <Alert className="grid-cols-[16px_1fr] gap-x-3 rounded-[10px] border-0 bg-[#fffbeb] px-4 py-3 text-[#b45309]">
          <img src={warningIcon} alt="" aria-hidden="true" className="mt-0.5 shrink-0" />
          <AlertDescription className="min-w-0 text-sm font-normal leading-5 text-[#b45309] text-wrap md:text-wrap">
            Los turnos pendientes no son compatibles con esta asignación. Para continuar, realiza una nueva asignación manual.
          </AlertDescription>
        </Alert>
        <div className="space-y-4">
          <h3 className="text-sm font-medium leading-5 text-[#374151]">Turnos pendientes</h3>
          <ul aria-label="Turnos pendientes para asignación manual" className="space-y-6">
            {candidates.map(candidate => <QueueAssignmentCandidate key={candidate.id} candidate={candidate} clockOffsetMs={clockOffsetMs}
              disabled={candidate.callable === false || candidate.assignment?.available === false || !candidate.allowedActions?.includes('call')}
              onSelect={entry => onSelectCandidate(entry, current.id)} />)}
          </ul>
          {!candidates.length && <p className="text-sm text-muted-foreground">La lista ha cambiado. No quedan turnos pendientes.</p>}
        </div>
      </div>}
    </TurnSheetFrame>
  </Sheet>
}
