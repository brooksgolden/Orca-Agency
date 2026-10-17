import { useCallback, useEffect, useRef, type RefObject } from 'react'
import { isTabStripPointerGestureActive } from './tab-strip-pointer-gesture'

export function useTabStripWheelScroll(
  tabStripRef: RefObject<HTMLDivElement | null>,
  onScroll: () => void
): (node: HTMLDivElement | null) => void {
  const surfaceRef = useRef<HTMLDivElement | null>(null)
  const onWheel = useCallback(
    (event: WheelEvent): void => {
      const strip = tabStripRef.current
      if (
        !strip ||
        event.ctrlKey ||
        isTabStripPointerGestureActive() ||
        strip.scrollWidth - strip.clientWidth <= 1
      ) {
        return
      }
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
      if (delta === 0) {
        return
      }
      event.preventDefault()
      strip.scrollLeft += delta
      onScroll()
    },
    [onScroll, tabStripRef]
  )
  const attachSurface = useCallback(
    (node: HTMLDivElement | null): void => {
      surfaceRef.current?.removeEventListener('wheel', onWheel)
      surfaceRef.current = node
      node?.addEventListener('wheel', onWheel, { passive: false })
    },
    [onWheel]
  )
  useEffect(() => () => surfaceRef.current?.removeEventListener('wheel', onWheel), [onWheel])
  return attachSurface
}
