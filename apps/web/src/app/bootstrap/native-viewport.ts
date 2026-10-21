/** Opt native WebViews into CSS safe-area insets without changing browser layout. */
export function configureNativeViewport(native: boolean, doc: Document = document) {
  if (!native) return
  doc.documentElement.dataset.nativeViewport = 'true'
  const viewport = doc.querySelector<HTMLMetaElement>('meta[name="viewport"]')
  if (!viewport) return
  const values = viewport.content.split(',').map(value => value.trim()).filter(value => !/^viewport-fit\s*=/.test(value))
  viewport.content = [...values, 'viewport-fit=cover'].join(', ')
}
