import { QueueIntroduction } from '../shared/QueueIntroduction'

export function NativeJoinQueueScreen() {
  return (
    <QueueIntroduction
      channelDescription="Continue in the app and receive queue updates with push notifications."
      onContinue={() => undefined}
    />
  )
}
