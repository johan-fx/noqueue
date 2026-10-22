import { Capacitor, type PermissionState } from '@capacitor/core'
import { PushNotifications } from '@capacitor/push-notifications'
import { LocalNotifications } from '@capacitor/local-notifications'
import { NativeSettings, AndroidSettings, IOSSettings } from 'capacitor-native-settings'

export type PushPermission = PermissionState | 'blocked' | 'unknown'

async function presentationPermission(receive: PermissionState): Promise<PushPermission> {
  if (receive !== 'granted' || Capacitor.getPlatform() !== 'android') return receive
  // Android <=12 reports receive=granted even when notifications are disabled.
  if (!(await LocalNotifications.areEnabled()).value) return 'blocked'
  const { channels } = await PushNotifications.listChannels().catch(error => {
    // Android 7 (still supported by the app) has no notification channels.
    if (error?.code === 'UNAVAILABLE') return { channels: [] }
    throw error
  })
  return channels.some(channel => channel.id === 'queue-updates' && channel.importance === 0)
    ? 'blocked' : 'granted'
}

export async function checkPushPermission(): Promise<PushPermission> {
  return presentationPermission((await PushNotifications.checkPermissions()).receive)
}

export async function requestPushPermission(): Promise<PushPermission> {
  return presentationPermission((await PushNotifications.requestPermissions()).receive)
}

export async function ensurePushChannel(): Promise<void> {
  try {
    await PushNotifications.createChannel({ id: 'queue-updates', name: 'NoQueue', importance: 4, visibility: 0 })
  } catch (error) {
    if ((error as { code?: string })?.code !== 'UNAVAILABLE') throw error
  }
}

/** Public OS settings APIs only; never deep-link to undocumented iOS prefs URLs. */
export async function openPushSettings(): Promise<boolean> {
  try {
    if ((await NativeSettings.open({ optionAndroid: AndroidSettings.AppNotification, optionIOS: IOSSettings.AppNotification })).status) return true
  } catch { /* Fall back to the app's settings if this OS cannot open notifications. */ }
  try {
    return (await NativeSettings.open({ optionAndroid: AndroidSettings.ApplicationDetails, optionIOS: IOSSettings.App })).status
  } catch { return false }
}
