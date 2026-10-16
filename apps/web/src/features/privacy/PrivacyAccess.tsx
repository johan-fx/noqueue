import { useEffect, useState } from 'react'
import { privacy } from './runtime'
export function PrivacyAccess() {
  const [en, setEn] = useState(new URLSearchParams(location.search).get('lang') === 'en')
  useEffect(() => {
    const update = () => setEn(new URLSearchParams(location.search).get('lang') === 'en')
    window.addEventListener('noqueue:locale', update)
    return () => window.removeEventListener('noqueue:locale', update)
  }, [])
  return <nav className="nq-privacy-access" aria-label={en ? 'Privacy' : 'Privacidad'}>
    <button type="button" onClick={() => privacy.show()}>{en ? 'Privacy and analytics' : 'Privacidad y analítica'}</button>
    <a href={`/privacy/?lang=${en ? 'en' : 'es'}`}>{en ? 'Privacy information' : 'Información de privacidad'}</a>
  </nav>
}
