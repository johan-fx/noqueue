import type { ComponentProps } from 'react'
import { cn } from 'cn'
import { Spinner } from '@/components/ui/spinner'

/** No visible copy: the accessible name is only announced by screen readers. */
export function LoadingSpinner({
  fullScreen = false,
  locale = 'es',
  className,
  ...props
}: ComponentProps<'div'> & { fullScreen?: boolean; locale?: 'es' | 'en' }) {
  return (
    <div
      className={cn(
        'flex items-center justify-center',
        fullScreen ? 'fixed inset-0 bg-background text-foreground' : 'w-full py-6',
        className,
      )}
      {...props}
    >
      <Spinner aria-label={locale === 'es' ? 'Cargando' : 'Loading'} />
    </div>
  )
}
