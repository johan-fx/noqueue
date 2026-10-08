import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { whatsappConsentNotice } from '../consent/whatsapp-consent-copy'
import type { Locale } from './shared'

const internationalPhone = /^\+[1-9]\d{7,14}$/

export function validPublicWhatsAppConsent(phone: string, consent: boolean) {
  return consent && internationalPhone.test(phone)
}

export function PublicWhatsAppConsentFields({
  locale,
  phone,
  consent,
  disabled,
  onPhoneChange,
  onConsentChange,
}: {
  locale: Locale
  phone: string
  consent: boolean
  disabled: boolean
  onPhoneChange: (phone: string) => void
  onConsentChange: (consent: boolean) => void
}) {
  const copy = whatsappConsentNotice[locale]
  return (
    <fieldset disabled={disabled} className="space-y-4">
      <label className="grid gap-3 font-medium" htmlFor="customer-phone">
        <span>
          {copy.phone}
          <span aria-hidden="true">*</span>
        </span>
        <Input
          id="customer-phone"
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          aria-label={copy.phone}
          placeholder={copy.phonePlaceholder}
          pattern="[+][1-9][0-9]{7,14}"
          required
          value={phone}
          onChange={(event) => onPhoneChange(event.target.value.trim())}
          className="h-11 text-sm!"
        />
        <span className="text-xs font-normal text-muted-foreground">
          {locale === 'es'
            ? 'Usa el formato internacional, por ejemplo +34600000000.'
            : 'Use international format, for example +34600000000.'}
        </span>
      </label>
      <label className="flex items-start gap-3 text-sm leading-5">
        <Checkbox
          id="customer-whatsapp-consent"
          className="mt-1"
          name="whatsapp-consent"
          checked={consent}
          disabled={disabled}
          aria-label={copy.consent}
          onCheckedChange={(checked) => onConsentChange(checked === true)}
        />
        <span>{copy.consent}</span>
      </label>
      <details className="text-xs leading-5 text-muted-foreground">
        <summary className="cursor-pointer underline underline-offset-2">
          {copy.details}
        </summary>
        <div className="mt-3 space-y-3">
          <p>{copy.introduction}</p>
          <p>
            <strong>{copy.purposeLabel}:</strong> {copy.purpose}
          </p>
          <p>
            <strong>{copy.retentionLabel}:</strong> {copy.retention}
          </p>
          <p>
            <strong>{copy.basisLabel}:</strong> {copy.basis}
          </p>
          <p>
            {copy.rights}{' '}
            <a className="underline" href={`mailto:${copy.email}`}>
              {copy.email}
            </a>
            .
          </p>
          <p>{copy.authority}</p>
        </div>
      </details>
    </fieldset>
  )
}
