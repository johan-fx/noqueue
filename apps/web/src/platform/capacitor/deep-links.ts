import { App } from '@capacitor/app'

export async function registerDeepLinkListener(
  onOpen: (url: URL) => void,
): Promise<() => Promise<void>> {
  const listener = await App.addListener('appUrlOpen', ({ url }) => {
    onOpen(new URL(url))
  })

  return () => listener.remove()
}
