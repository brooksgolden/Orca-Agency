import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { acquireWebviewsDragPassthrough } from '../browser-pane/host-guest/webview-registry'
import {
  dispatchWorkspacePanePointerClear,
  dispatchWorkspacePanePointerDrop,
  dispatchWorkspacePanePointerMove
} from './workspace-pane-pointer-drag'

export function isWorkspaceHeaderDragTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    !target.closest(
      'button, a, input, textarea, select, [role="tab"], [role="button"], [contenteditable="true"], .terminal-tab-strip'
    )
  )
}

/** Reuse sidebar placement without converting terminal input or native window drags. */
export function useWorkspaceHeaderDrag(worktreeId: string) {
  const cleanupRef = useRef<(() => void) | null>(null)
  useEffect(() => () => cleanupRef.current?.(), [])
  return (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || !isWorkspaceHeaderDragTarget(event.target) || cleanupRef.current) {
      return
    }
    const header = event.currentTarget
    const pointerId = event.pointerId
    const startX = event.clientX
    const startY = event.clientY
    let active = false
    let releaseWebviews: (() => void) | undefined
    const cleanup = () => {
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerup', end, true)
      window.removeEventListener('pointercancel', cancel, true)
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('blur', cleanup)
      header.removeEventListener('lostpointercapture', cleanup)
      if (header.hasPointerCapture(pointerId)) {
        header.releasePointerCapture(pointerId)
      }
      releaseWebviews?.()
      dispatchWorkspacePanePointerClear()
      cleanupRef.current = null
    }
    const move = (next: PointerEvent) => {
      if (next.pointerId !== pointerId) {
        return
      }
      if (!active) {
        if (Math.hypot(next.clientX - startX, next.clientY - startY) < 6) {
          return
        }
        active = true
        releaseWebviews = acquireWebviewsDragPassthrough()
        header.setPointerCapture(pointerId)
      }
      next.preventDefault()
      next.stopPropagation()
      dispatchWorkspacePanePointerMove({ sourceId: worktreeId, x: next.clientX, y: next.clientY })
    }
    const end = (next: PointerEvent) => {
      if (next.pointerId !== pointerId) {
        return
      }
      if (active) {
        next.preventDefault()
        next.stopPropagation()
        dispatchWorkspacePanePointerDrop({ sourceId: worktreeId, x: next.clientX, y: next.clientY })
      }
      cleanup()
    }
    const cancel = (next: PointerEvent) => {
      if (next.pointerId === pointerId) {
        cleanup()
      }
    }
    const key = (next: KeyboardEvent) => {
      if (next.key === 'Escape') {
        next.preventDefault()
        next.stopPropagation()
        cleanup()
      }
    }
    cleanupRef.current = cleanup
    window.addEventListener('pointermove', move, true)
    window.addEventListener('pointerup', end, true)
    window.addEventListener('pointercancel', cancel, true)
    window.addEventListener('keydown', key, true)
    window.addEventListener('blur', cleanup)
    header.addEventListener('lostpointercapture', cleanup)
  }
}
