import { Button } from '@/components/ui/button'

/** Figma 572:10413, with the activation CTA below the message. */
export function NativePushNotice({ locale, busy, onActivate, icon }: {
  locale: 'es' | 'en'
  busy: boolean
  onActivate: () => void
  icon: string
}) {
  const es = locale === 'es'
  return <section aria-label={es ? 'Notificaciones del turno' : 'Turn notifications'} aria-busy={busy}
    className="flex items-start gap-2 rounded-lg bg-orange-50 p-2 font-sans">
    <div className="shrink-0 p-1.5"><img src={icon} alt="" className="block" /></div>
    <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
      <p className="text-base leading-6 font-normal wrap-break-word text-gray-500">
        {es ? 'Activa las notificaciones para recibir actualizaciones sobre tu turno' : 'Enable notifications to receive updates about your turn'}
      </p>
      <Button className="min-h-11" disabled={busy} onClick={onActivate}>{es ? 'Activar' : 'Enable'}</Button>
    </div>
  </section>
}
