import { Link, useLinkClickHandler, useLocation, useResolvedPath, type LinkProps } from 'react-router'
import {
  canUseNativeViewTransitions,
  setNativeTransitionIntent,
  transitionIntentForPathChange,
  type NativeTransitionIntent,
} from './native-transitions'
import { detectRuntime } from '../bootstrap/runtime'

export type AppLinkProps = Omit<LinkProps, 'viewTransition'> & {
  /** Visual direction only. Defaults to forward, or replace when `replace` is set. */
  intent?: NativeTransitionIntent
}

function isSameOriginPathLink(
  event: React.MouseEvent<HTMLAnchorElement>,
  props: Pick<AppLinkProps, 'target' | 'reloadDocument' | 'download'>,
) {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.altKey ||
    event.ctrlKey ||
    event.shiftKey ||
    (props.target && props.target !== '_self') ||
    props.reloadDocument ||
    props.download
  ) return false

  try {
    return new URL(event.currentTarget.href).origin === window.location.origin
  } catch {
    return false
  }
}

/** Router Link wrapper that enables View Transitions only for native path changes. */
export function AppLink({ intent, replace, onClick, to, relative, ...props }: AppLinkProps) {
  const location = useLocation()
  const resolved = useResolvedPath(to, relative ? { relative } : {})
  const mode = transitionIntentForPathChange(
    location.pathname,
    resolved.pathname,
    intent,
    replace,
  )
  const enabled = mode !== 'none' && canUseNativeViewTransitions()
  const clickOptions = {
    ...(props.target ? { target: props.target } : {}),
    ...(replace !== undefined ? { replace } : {}),
    ...(props.mask !== undefined ? { mask: props.mask } : {}),
    ...(props.state !== undefined ? { state: props.state } : {}),
    ...(props.preventScrollReset !== undefined ? { preventScrollReset: props.preventScrollReset } : {}),
    ...(relative ? { relative } : {}),
    ...(props.defaultShouldRevalidate !== undefined ? { defaultShouldRevalidate: props.defaultShouldRevalidate } : {}),
  }
  const navigateWithoutViewTransition = useLinkClickHandler(to, {
    ...clickOptions,
    viewTransition: false,
  })
  const navigateWithViewTransition = useLinkClickHandler(to, {
    ...clickOptions,
    viewTransition: true,
  })

  return (
    <Link
      {...props}
      to={to}
      {...(relative ? { relative } : {})}
      {...(replace !== undefined ? { replace } : {})}
      viewTransition={enabled}
      onClick={(event) => {
        onClick?.(event)
        if (detectRuntime() !== 'native' || !isSameOriginPathLink(event, props)) return

        // Motion preference can change without a route render. Recheck in the
        // click turn and bypass Link's render-time option if it became stale.
        const enabledNow = mode !== 'none' && canUseNativeViewTransitions()
        if (enabledNow === enabled) {
          if (enabledNow) setNativeTransitionIntent(mode)
          return
        }

        event.preventDefault()
        if (enabledNow) setNativeTransitionIntent(mode)
        ;(enabledNow ? navigateWithViewTransition : navigateWithoutViewTransition)(event)
      }}
    />
  )
}
