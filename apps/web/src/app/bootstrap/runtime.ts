import { Capacitor } from '@capacitor/core'

export type AppRuntime = 'native' | 'web'

export function detectRuntime(): AppRuntime {
  return Capacitor.isNativePlatform() ? 'native' : 'web'
}
