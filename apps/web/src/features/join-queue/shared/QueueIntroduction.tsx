import { Button } from '@/components/ui/button'

interface QueueIntroductionProps {
  channelDescription: string
  onContinue: () => void
}

export function QueueIntroduction({
  channelDescription,
  onContinue,
}: QueueIntroductionProps) {
  return (
    <section className="space-y-4 rounded-xl border bg-card p-6 shadow-sm">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Join the queue</h1>
        <p className="text-muted-foreground">{channelDescription}</p>
      </div>
      <Button onClick={onContinue}>Continue</Button>
    </section>
  )
}
