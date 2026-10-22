import { describe, expect, it } from 'vitest'
import { configureNativeViewport } from './native-viewport'
describe('native viewport', () => {
  function documentWith(content: string) {
    const doc = document.implementation.createHTMLDocument()
    const meta = doc.createElement('meta'); meta.name = 'viewport'; meta.content = content
    doc.head.append(meta)
    return { doc, meta }
  }
  it('leaves web viewport untouched', () => {
    const { doc, meta } = documentWith('width=device-width, initial-scale=1.0')
    configureNativeViewport(false, doc)
    expect(meta.content).toBe('width=device-width, initial-scale=1.0')
    expect(doc.documentElement.hasAttribute('data-native-viewport')).toBe(false)
  })
  it('enables safe-area once without restricting zoom', () => {
    const { doc, meta } = documentWith('width=device-width, initial-scale=1.0, viewport-fit=contain')
    configureNativeViewport(true, doc); configureNativeViewport(true, doc)
    expect(meta.content).toBe('width=device-width, initial-scale=1.0, viewport-fit=cover')
    expect(doc.documentElement.dataset.nativeViewport).toBe('true')
  })
  it('does not throw without a meta tag', () => {
    expect(() => configureNativeViewport(true, document.implementation.createHTMLDocument())).not.toThrow()
  })
})
