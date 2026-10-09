import { phoneSchema } from '@noqueue/contracts/queue'
import { isPossiblePhoneNumber } from 'react-phone-number-input'

export function isPossibleE164PhoneNumber(phone: string): boolean {
  return phoneSchema.safeParse(phone).success && isPossiblePhoneNumber(phone)
}

export function validPublicWhatsAppConsent(phone: string, consent: boolean) {
  return consent && isPossibleE164PhoneNumber(phone)
}
