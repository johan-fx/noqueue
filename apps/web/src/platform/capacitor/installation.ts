import { registerPlugin } from '@capacitor/core'
import { z } from 'zod'
import { mobileServiceJoinSchema, type MobileServiceJoin } from '@noqueue/contracts/queue'

const vault = registerPlugin<{
  read(): Promise<{ value: string | null }>
  write(options: { value: string }): Promise<void>
}>('NoQueueVault')
const schema = z.strictObject({
  version: z.literal(1),
  secret: z.string().regex(/^[a-f0-9]{64}$/),
  pending: z.array(z.strictObject({ serviceId: z.string(), key: z.uuid(), input: mobileServiceJoinSchema })).max(50),
})
type State = z.infer<typeof schema>
let state: Promise<State> | undefined
let writes: Promise<unknown> = Promise.resolve()
function read(): Promise<State> {
  if (!state) {
    state = (async () => {
      const { value } = await vault.read()
      // Corruption/keychain errors must never silently replace an identity.
      if (value !== null) return schema.parse(JSON.parse(value))
      const secret = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('')
      const fresh: State = { version: 1, secret, pending: [] }
      await vault.write({ value: JSON.stringify(fresh) })
      return fresh
    })().catch(error => { state = undefined; throw error })
  }
  return state
}
function update(change: (state: State) => void): Promise<State> {
  const operation = writes.catch(() => undefined).then(async () => {
    const next = structuredClone(await read())
    change(next)
    schema.parse(next)
    await vault.write({ value: JSON.stringify(next) })
    state = Promise.resolve(next)
    return next
  })
  writes = operation
  return operation
}
export async function installationSecret() {
  return (await read()).secret
}
export async function prepareMobileJoin(serviceId: string, key: string, input: MobileServiceJoin) {
  const parsed = mobileServiceJoinSchema.parse(input)
  const saved = await update(state => {
    const existing = state.pending.find(p => p.serviceId === serviceId && JSON.stringify(p.input) === JSON.stringify(parsed))
    if (!existing) state.pending.push({ serviceId, key, input: parsed })
  })
  return saved.pending.find(p => p.serviceId === serviceId && JSON.stringify(p.input) === JSON.stringify(parsed))!
}
export async function finishMobileJoin(key: string) {
  await update(state => { state.pending = state.pending.filter(p => p.key !== key) })
}
