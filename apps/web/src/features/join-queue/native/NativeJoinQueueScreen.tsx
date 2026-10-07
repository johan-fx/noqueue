import { QueueIntroduction } from '../shared/QueueIntroduction'

export function NativeJoinQueueScreen() {
  return (
    <QueueIntroduction
      channelDescription="Continue in the app and receive waiting list updates with push notifications."
      onContinue={() => undefined}
    />
  )
}
