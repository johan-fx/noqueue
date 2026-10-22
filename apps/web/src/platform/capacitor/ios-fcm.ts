import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'
// iOS only. No web implementation and no Firebase JS SDK/Analytics/Auth imports.
export const IosFcm = registerPlugin<{
  availability(): Promise<{ available: boolean; initialized: boolean }>
  start(): Promise<void>
  pause(): Promise<void>
  stop(): Promise<void>
  addListener(event: 'tokenReceived', handler: (data: { token: string }) => void): Promise<PluginListenerHandle>
  addListener(event: 'tokenError', handler: () => void): Promise<PluginListenerHandle>
}>('NoQueueFcm')
