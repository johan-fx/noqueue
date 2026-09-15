import { useNavigate } from 'react-router'
import { QueueIntroduction } from '../shared/QueueIntroduction'

export function WebJoinQueueScreen() {
  const navigate = useNavigate()
  return (
    <QueueIntroduction
      channelDescription="Continue on the web and receive queue updates through WhatsApp."
      onContinue={() => navigate('/q/demo-queue')}
    />
  )
}
