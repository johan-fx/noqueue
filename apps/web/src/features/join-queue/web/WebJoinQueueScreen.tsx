import { QueueIntroduction } from '../shared/QueueIntroduction'

export function WebJoinQueueScreen() {
  return (
    <QueueIntroduction
      channelDescription="Continue on the web and receive queue updates through WhatsApp."
      onContinue={() => undefined}
    />
  )
}
