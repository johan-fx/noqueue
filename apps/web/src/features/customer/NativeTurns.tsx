import { Navigate } from 'react-router'
import { useLocale } from './public-resource'

/** Old builds/bookmarks remain valid. NativeTurnGate resolves active ownership first. */
export function NativeTurns() {
  const [locale] = useLocale()
  return <Navigate replace to={`/?lang=${locale}`} />
}
