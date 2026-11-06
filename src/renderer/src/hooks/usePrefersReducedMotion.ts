import { readMediaQuery, useMediaQuery } from './use-media-query'

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

/** Read once, at call time: for an imperative scroll there is nothing to re-render on. */
export function readPrefersReducedMotion(): boolean {
  return readMediaQuery(REDUCED_MOTION_QUERY)
}

// Why: a scripted scroll's explicit `behavior` is not affected by CSS or the OS setting.
export function motionSafeScrollBehavior(behavior: ScrollBehavior = 'smooth'): ScrollBehavior {
  return behavior === 'smooth' && readPrefersReducedMotion() ? 'auto' : behavior
}

export function usePrefersReducedMotion(): boolean {
  return useMediaQuery(REDUCED_MOTION_QUERY)
}
