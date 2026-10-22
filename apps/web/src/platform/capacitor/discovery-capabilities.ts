import { detectRuntime } from '@/app/bootstrap/runtime'
import { qrDestination } from '@/features/customer/discovery-state'
import { customerRouteFromUrl } from './deep-link-routing'

/** Same discovery UI; only the capability implementation varies by runtime. */
export async function discoveryPosition(): Promise<{ latitude: number; longitude: number }> {
  if (detectRuntime() === 'native') {
    const { Geolocation } = await import('@capacitor/geolocation')
    const permission = await Geolocation.checkPermissions()
    if (permission.coarseLocation !== 'granted') {
      const requested = await Geolocation.requestPermissions({ permissions: ['coarseLocation'] })
      if (requested.coarseLocation !== 'granted') throw new Error('location_denied')
    }
    const { coords } = await Geolocation.getCurrentPosition({ enableHighAccuracy: false, timeout: 10000, maximumAge: 0 })
    return { latitude: coords.latitude, longitude: coords.longitude }
  }
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('location_unavailable')); return }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ latitude: coords.latitude, longitude: coords.longitude }), reject,
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 0 },
    )
  })
}
export function discoveryQrDestination(value: string): string | null {
  if (detectRuntime() !== 'native') return qrDestination(value, window.location.origin)
  const route = customerRouteFromUrl(value, import.meta.env.VITE_PUBLIC_APP_ORIGIN)
  if (!route || !/^\/(q|v)\//.test(route)) return null
  const url = new URL(value)
  if ([...url.searchParams.keys()].some(key => key !== 'lang')) return null
  return route
}
