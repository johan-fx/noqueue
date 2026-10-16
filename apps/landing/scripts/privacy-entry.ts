import { startPrivacy } from '@noqueue/privacy'
import '@noqueue/privacy/styles.css'
declare const __PRIVACY_CONFIG__: { environment: string; enabled: boolean; measurementId: string }
const locale = () => document.documentElement.lang === 'en' ? 'en' : 'es'
const privacy = startPrivacy({ ...__PRIVACY_CONFIG__, surface: 'landing', native: false }, locale())
document.querySelectorAll('[data-privacy-settings]').forEach((button) => button.addEventListener('click', () => privacy.show()))
new MutationObserver(() => privacy.setLanguage(locale())).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })
