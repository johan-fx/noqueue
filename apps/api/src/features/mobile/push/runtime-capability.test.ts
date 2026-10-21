import { connect } from 'node:http2'
import { expect, it } from 'vitest'

// Revisit the architecture gate when the installed runtime gains a real client.
// Invalid URL guarantees no outbound connection even in a future implementation.
it('documents that this workerd runtime has a node:http2.connect stub, not an APNs fallback', () => {
  expect(() => connect('not-a-valid-url')).toThrow(/not.*implemented|unimplemented/i)
})
