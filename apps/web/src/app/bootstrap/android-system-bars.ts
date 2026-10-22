import { Capacitor, SystemBars, SystemBarsStyle, SystemBarType } from '@capacitor/core'

/** Capacitor 8 owns the insets and icon style; CSS paints the edge-to-edge surface. */
export async function configureAndroidSystemBars(doc: Document = document) {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return
  doc.documentElement.dataset.androidStatusBar = 'true'
  if (!doc.getElementById('noqueue-android-status-bar')) {
    const surface = doc.createElement('div')
    surface.id = 'noqueue-android-status-bar'
    surface.setAttribute('aria-hidden', 'true')
    doc.body.prepend(surface)
  }
  try {
    // LIGHT means dark icons on a light surface, not white icons.
    await SystemBars.setStyle({ style: SystemBarsStyle.Light, bar: SystemBarType.StatusBar })
  } catch {
    // Cosmetic bridge failure must not prevent anonymous turn recovery.
  }
}
