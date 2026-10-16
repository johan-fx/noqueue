import { legalCopy } from '@noqueue/privacy/legal'
import { useLocale } from '@/features/customer/public-resource'
import { CustomerShell } from '@/features/customer/shared'
export function PrivacyPage() {
  const [locale, setLocale] = useLocale()
  const copy = legalCopy[locale]
  return <CustomerShell title={copy.title} back="/" locale={locale} setLocale={setLocale}>
    <article className="nq-privacy-legal">
      <h1>{copy.title}</h1>
      {copy.sections.map(([title, body]) => <section key={title}><h2>{title}</h2><p>{body}</p></section>)}
      <p><a href="https://policies.google.com/privacy" rel="noreferrer">Google — {locale === 'es' ? 'Privacidad' : 'Privacy'}</a></p>
      <p><a href="https://www.aepd.es/" rel="noreferrer">AEPD</a></p>
    </article>
  </CustomerShell>
}
