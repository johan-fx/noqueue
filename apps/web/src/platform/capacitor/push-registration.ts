import { PushNotifications } from '@capacitor/push-notifications'

export async function requestNativePushRegistration(): Promise<void> {
  const permission = await PushNotifications.requestPermissions()

  if (permission.receive === 'granted') {
    await PushNotifications.register()
  }
}
