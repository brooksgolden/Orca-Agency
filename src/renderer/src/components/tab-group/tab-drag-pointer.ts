import type { DragEndEvent, DragMoveEvent, DragOverEvent } from '@dnd-kit/core'

type DragPointerEvent = Pick<
  DragMoveEvent | DragOverEvent | DragEndEvent,
  'activatorEvent' | 'delta' | 'active'
>

type DragPointer = { x: number; y: number }

// Why: the recorded pointer is keyed to the drag's activator so a stale pointer from an
// earlier drag can never be read. The single form is used by the pointer sensor callers.
const currentPointerByActivator = new WeakMap<Event, DragPointer>()

export function recordTabDragPointer(activator: Event, pointer: DragPointer): void {
  currentPointerByActivator.set(activator, pointer)
}

/** Pointer position during a tab drag. Why: sortable tabs stay visually anchored
 *  (no transform) while DragOverlay follows the cursor, so active.rect.translated
 *  never tracks the pointer and panel-edge split targets would stay wrong. The delta
 *  is scroll-adjusted, so the recorded pointer is preferred over a delta-derived one. */
export function getDragPointer(event: DragPointerEvent): DragPointer | null {
  const activator = event.activatorEvent
  if (activator && typeof activator === 'object') {
    const recorded = currentPointerByActivator.get(activator)
    if (recorded) {
      return recorded
    }
  }
  if (
    activator &&
    typeof activator === 'object' &&
    'clientX' in activator &&
    'clientY' in activator &&
    typeof activator.clientX === 'number' &&
    typeof activator.clientY === 'number'
  ) {
    return {
      x: activator.clientX + event.delta.x,
      y: activator.clientY + event.delta.y
    }
  }

  const initial = event.active.rect.current.initial
  if (!initial) {
    return null
  }

  return {
    x: initial.left + initial.width / 2 + event.delta.x,
    y: initial.top + initial.height / 2 + event.delta.y
  }
}
