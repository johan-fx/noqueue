import { useId, useState } from 'react'
import { PhoneInput } from '@/components/ui/phone-input'
import { Checkbox } from '@/components/ui/checkbox'
import { isPossibleE164PhoneNumber } from '@/lib/phone-validation'
import { whatsappConsentNotice } from '../consent/whatsapp-consent-copy'
import type { Locale } from './shared'

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
  const id = useId()
  const phoneId = `${id}-phone`
  const consentId = `${id}-whatsapp-consent`
  const [phoneTouched, setPhoneTouched] = useState(false)
  const showPhoneError = phoneTouched && !isPossibleE164PhoneNumber(phone)
  return (
    <fieldset disabled={disabled} className="space-y-4">
      <label className="grid gap-3 font-medium" htmlFor={phoneId}>
        <span>
          {copy.phone}
          <span aria-hidden="true">*</span>
        </span>
        <PhoneInput
          id={phoneId}
          name="phone"
          locale={locale}
          aria-label={copy.phone}
          placeholder={copy.phonePlaceholder}
          aria-invalid={showPhoneError}
          aria-describedby={`${id}-phone-hint${showPhoneError ? ` ${id}-phone-error` : ''}`}
          required
          disabled={disabled}
          value={phone}
          onBlur={() => setPhoneTouched(true)}
          onChange={onPhoneChange}
          className="h-11 text-sm!"
        />
        <span
          id={`${id}-phone-hint`}
          className="text-xs font-normal text-muted-foreground"
        >
          {locale === 'es'
            ? 'Selecciona tu país e introduce solo el número nacional.'
            : 'Select your country and enter only your national number.'}
        </span>
        {showPhoneError && (
          <span
            id={`${id}-phone-error`}
            role="alert"
            className="text-xs font-normal text-destructive"
          >
            {copy.phoneInvalid}
          </span>
        )}
      </label>
      <label className="flex items-start gap-3 text-sm leading-5">
        <Checkbox
          id={consentId}
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
