import { useState } from 'react'

/** Figma's branding slot, shared by registration, confirmation and QR. */
export function PublicVenueLogo({
  url,
  venueName,
}: {
  url: string | null | undefined
  venueName: string
}) {
  // A new immutable URL (or a different venue) must be allowed to load again.
  return url ? <LogoImage key={url} url={url} venueName={venueName} /> : null
}

function LogoImage({ url, venueName }: { url: string; venueName: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) return null
  return (
    <img
      src={url}
      alt={venueName}
      width={192}
      height={111}
      className="h-[111px] w-48 max-w-full shrink-0 object-contain"
      onError={() => setFailed(true)}
    />
  )
}
