import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'
import { useId, useRef, useState } from 'react'
import { Check, Minus, Plus } from 'lucide-react'
import {
  manualConsentVersion,
  manualJoinSchema,
  phoneSchema,
  type ManualJoin,
  type PublicService,
} from '@noqueue/contracts/queue'
import { Button } from '@/components/ui/button'
import { DrawerFooter } from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import { Field, FieldLabel } from '@/components/ui/field'
import { Switch } from '@/components/ui/switch'
import { cn } from 'cn'
import { receptionLabels } from './queue-labels'
import {
  manualQueueCopy,
  manualQueueError,
  type ManualLocale,
} from './manual-queue-copy'

const countryPrefixes = [
  ['+34', '🇪🇸'],
  ['+33', '🇫🇷'],
  ['+351', '🇵🇹'],
  ['+44', '🇬🇧'],
  ['+49', '🇩🇪'],
  ['+39', '🇮🇹'],
  ['+1', '🇺🇸'],
  ['', '🌐'],
] as const

export function ManualQueueEntryForm({
  service,
  locale,
  whatsappRequired,
  onSubmit,
  onBusyChange,
}: {
  service: Pick<PublicService, 'type' | 'receptionServices' | 'spaces'>
  locale: ManualLocale
  whatsappRequired: boolean
  onSubmit: (input: ManualJoin, key: string) => Promise<void>
  onBusyChange?: (busy: boolean) => void
}) {
  const copy = manualQueueCopy[locale]
  const countryCodes = countryPrefixes.map(
    ([code, flag], index) => [code, flag, copy.countries[index]] as const,
  )
  const id = useId()
  const [displayName, setDisplayName] = useState('')
  const [phone, setPhone] = useState('')
  const [prefix, setPrefix] = useState('+34')
  const [consent, setConsent] = useState(false)
  const [partySize, setPartySize] = useState(1)
  const [receptionService, setReceptionService] = useState(
    service.receptionServices[0],
  )
  const [preferredSpaceId, setPreferredSpaceId] = useState('fastest')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const lock = useRef(false)
  const attempt = useRef<{ body: string; key: string } | null>(null)
  const compactPhone = phone.replace(/[\s()-]/g, '')
  const internationalPhone = compactPhone.startsWith('+')
    ? compactPhone
    : `${prefix}${compactPhone}`
  const validContact = consent
    ? phoneSchema.safeParse(internationalPhone).success
    : !whatsappRequired
  const compatible =
    service.type !== 'restaurant' ||
    service.spaces.some(
      (space) =>
        (preferredSpaceId === 'fastest' || preferredSpaceId === space.id) &&
        partySize <= space.maxPartySize,
    )
  const ready =
    !!displayName.trim() &&
    validContact &&
    compatible &&
    (service.type !== 'reception' || !!receptionService)
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (lock.current || !ready) return
    const parsed = manualJoinSchema.safeParse({
      displayName: displayName.trim(),
      partySize,
      locale,
      whatsapp: consent
        ? {
            consent: true,
            phone: internationalPhone,
            version: manualConsentVersion,
          }
        : { consent: false },
      ...(service.type === 'reception' ? { receptionService } : {}),
      ...(service.type === 'restaurant' ? { preferredSpaceId } : {}),
    })
    if (!parsed.success) {
      setError('invalid')
      return
    }
    lock.current = true
    setBusy(true)
    onBusyChange?.(true)
    setError(null)
    const body = JSON.stringify(parsed.data)
    if (attempt.current?.body !== body)
      attempt.current = { body, key: crypto.randomUUID() }
    try {
      await onSubmit(parsed.data, attempt.current.key)
    } catch (error) {
      setError(error)
    } finally {
      lock.current = false
      setBusy(false)
      onBusyChange?.(false)
    }
  }
  function choice(
    value: string,
    label: string,
    selected: boolean,
    onSelect: () => void,
    disabled = false,
  ) {
    return (
      <Button
        key={value}
        type="button"
        variant="outline"
        disabled={disabled}
        aria-pressed={selected}
        className={cn(
          'min-h-12 w-full justify-between whitespace-normal px-4 py-3 text-left text-base font-normal text-gray-700 shadow-xs',
          selected && 'border-gray-800',
        )}
        onClick={onSelect}
      >
        {label}
        {selected && <Check aria-hidden="true" className="size-5 shrink-0" />}
      </Button>
    )
  }
  return (
    <form
      lang={locale}
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(event) => void submit(event)}
    >
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 pt-6">
        <h2 className="mb-4 text-3xl font-medium text-gray-800">
          {copy.title}
        </h2>
        <fieldset disabled={busy} className="space-y-6">
          <Field className="gap-4">
            <FieldLabel
              htmlFor={`${id}-name`}
              className="text-base font-medium"
            >
              {copy.name}*
            </FieldLabel>
            <Input
              id={`${id}-name`}
              aria-label={copy.name}
              className="h-11"
              placeholder={copy.namePlaceholder}
              required
              maxLength={100}
              autoComplete="name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </Field>
          {service.type === 'restaurant' && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <FieldLabel
                  htmlFor={`${id}-size`}
                  className="text-base font-medium"
                >
                  {copy.diners}
                </FieldLabel>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="size-11 rounded-xl"
                    disabled={partySize <= 1}
                    aria-label={copy.fewer}
                    onClick={() => setPartySize((size) => size - 1)}
                  >
                    <Minus aria-hidden="true" />
                  </Button>
                  <input
                    id={`${id}-size`}
                    aria-label={copy.dinerCount}
                    type="number"
                    min={1}
                    max={20}
                    required
                    value={partySize}
                    className="h-11 w-8 appearance-none bg-transparent text-center font-medium [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    onChange={(e) => setPartySize(e.target.valueAsNumber)}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="size-11 rounded-xl"
                    disabled={partySize >= 20}
                    aria-label={copy.more}
                    onClick={() => setPartySize((size) => size + 1)}
                  >
                    <Plus aria-hidden="true" />
                  </Button>
                </div>
              </div>
              <Field className="gap-4">
                <FieldLabel className="text-base font-medium">
                  {copy.table}
                </FieldLabel>
                <div
                  role="group"
                  aria-label={copy.space}
                  className="grid grid-cols-2 gap-4"
                >
                  {service.spaces.map((space) =>
                    choice(
                      space.id,
                      space.name,
                      preferredSpaceId === space.id,
                      () => setPreferredSpaceId(space.id),
                      partySize > space.maxPartySize,
                    ),
                  )}
                  {choice(
                    'fastest',
                    copy.fastest,
                    preferredSpaceId === 'fastest',
                    () => setPreferredSpaceId('fastest'),
                  )}
                </div>
                {!compatible && (
                  <p className="text-sm text-destructive">{copy.capacity}</p>
                )}
              </Field>
            </>
          )}
          {service.type === 'reception' && (
            <Field className="gap-4">
              <FieldLabel className="text-base font-medium">
                {copy.task}
              </FieldLabel>
              <div
                role="group"
                aria-label={copy.taskType}
                className="grid grid-cols-2 gap-2"
              >
                {service.receptionServices.map((type) =>
                  choice(
                    type,
                    type === 'other' ? copy.other : receptionLabels[type],
                    receptionService === type,
                    () => setReceptionService(type),
                  ),
                )}
              </div>
            </Field>
          )}
          <Field className="gap-4">
            <FieldLabel
              htmlFor={`${id}-phone`}
              className="text-base font-medium"
            >
              {copy.phone}
              {whatsappRequired || consent ? '*' : ''}
            </FieldLabel>
            <div className="flex gap-2">
              <Select
                items={countryCodes.map(([code, flag, name]) => ({
                  value: code || 'international',
                  label: `${flag} ${name} ${code}`,
                }))}
                value={prefix || 'international'}
                onValueChange={(value) => {
                  if (value !== null)
                    setPrefix(value === 'international' ? '' : value)
                }}
              >
                <SelectTrigger
                  aria-label={copy.prefix}
                  title={prefix || copy.international}
                  disabled={busy}
                  className="h-11 w-20 shrink-0"
                >
                  <SelectValue>
                    {countryCodes.find(([code]) => code === prefix)?.[1]}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  {countryCodes.map(([code, flag, name]) => (
                    <SelectItem key={code} value={code || 'international'}>
                      {flag} {name} {code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                id={`${id}-phone`}
                aria-label={copy.phone}
                className="h-11 min-w-0 flex-1"
                type="tel"
                autoComplete="tel-national"
                inputMode="tel"
                placeholder={prefix ? copy.phonePlaceholder : '+34600000000'}
                required={whatsappRequired || consent}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
            <label className="flex items-start gap-5 text-xs font-medium leading-[1.4] text-gray-500">
              <Switch
                className="mt-0.5"
                checked={consent}
                onCheckedChange={setConsent}
                aria-label={copy.consent}
              />
              <span>{copy.consent}</span>
            </label>
            <div className="space-y-2 text-xs leading-[1.4] text-gray-600">
              <p>{copy.introduction}</p>
              <ul className="list-disc space-y-2 pl-4">
                <li>
                  <strong>{copy.purposeLabel}:</strong> {copy.purpose}
                </li>
                <li>
                  <strong>{copy.retentionLabel}:</strong> {copy.retention}
                </li>
                <li>
                  <strong>{copy.basisLabel}:</strong> {copy.basis}
                </li>
              </ul>
              <p>
                {copy.rights}{' '}
                <a className="underline" href="mailto:hola@noqueue-app.com">
                  hola@noqueue-app.com
                </a>
                .
              </p>
              <p>{copy.authority}</p>
            </div>
          </Field>
        </fieldset>
        {!whatsappRequired && (
          <p className="mt-4 text-xs text-muted-foreground">{copy.local}</p>
        )}
        {error != null && (
          <p role="alert" className="mt-4 text-sm text-destructive">
            {error === 'invalid'
              ? copy.invalid
              : manualQueueError(error, locale)}
          </p>
        )}
      </div>
      <DrawerFooter className="border-t bg-background p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <Button className="h-12 w-full" type="submit" disabled={busy || !ready}>
          {busy ? copy.saving : copy.add}
        </Button>
      </DrawerFooter>
    </form>
  )
}
