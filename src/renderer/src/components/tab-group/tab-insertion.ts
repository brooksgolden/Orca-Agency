import { useCallback, useRef, useState } from 'react'
import type { DragEndEvent, DragMoveEvent, DragOverEvent } from '@dnd-kit/core'
import type { TabDragItemData } from './tab-drag-data'
import { isTabDragData } from './tab-drag-data'
import type { TabGroupStripHit } from './tab-group-strip-hit'

// Why: when a tab is dragged over another tab's sortable rect, we compute
// which side of the hovered tab the drop will land on (before vs. after).
// Rendering a blue insertion bar at that edge makes the drop target feel
// VS Code-like even though dnd-kit's default sortable animation already
// slides tabs apart.
export type HoveredTabInsertion = {
  groupId: string
  unifiedTabId: string
  visibleTabId: string
  side: 'left' | 'right'
}

export type TabIndicatorEdge = {
  visibleTabId: string
  side: 'left' | 'right'
}

export function resolveTabInsertion(
  event: DragMoveEvent | DragOverEvent | DragEndEvent,
  isTabDragData: (value: unknown) => value is TabDragItemData,
  getDragCenter: (event: DragMoveEvent | DragOverEvent | DragEndEvent) => {
    x: number
    y: number
  } | null
): HoveredTabInsertion | null {
  const overData = event.over?.data.current
  const activeData = event.active.data.current
  if (!event.over || !isTabDragData(activeData) || !isTabDragData(overData)) {
    return null
  }
  // Why: dropping a tab onto itself is a no-op — suppress the indicator there
  // so users don't see a false positive target.
  if (activeData.unifiedTabId === overData.unifiedTabId) {
    return null
  }
  const center = getDragCenter(event)
  if (!center) {
    return null
  }
  const midpoint = event.over.rect.left + event.over.rect.width / 2
  return {
    groupId: overData.groupId,
    unifiedTabId: overData.unifiedTabId,
    visibleTabId: overData.visibleTabId,
    side: center.x < midpoint ? 'left' : 'right'
  }
}

export function resolvePointerStripInsertion(
  event: DragMoveEvent | DragOverEvent | DragEndEvent,
  strip: TabGroupStripHit | null,
  pointer: { x: number; y: number } | null,
  tabOrder?: readonly string[]
): HoveredTabInsertion | null {
  const activeData = event.active.data.current
  if (!strip || strip.blocked || !pointer || !isTabDragData(activeData)) {
    return null
  }
  const target = strip.tabAtPointer ?? strip.nextTab ?? strip.lastTab
  if (target) {
    if (target.unifiedTabId === activeData.unifiedTabId) {
      return null
    }
    const insertion: HoveredTabInsertion = {
      groupId: strip.groupId,
      unifiedTabId: target.unifiedTabId,
      visibleTabId: target.visibleTabId,
      side: strip.tabAtPointer
        ? pointer.x < target.rect.left + target.rect.width / 2
          ? 'left'
          : 'right'
        : strip.nextTab
          ? 'left'
          : 'right'
    }
    return isUnchangedInsertion(activeData, insertion, tabOrder) ? null : insertion
  }
  if (
    !event.over ||
    pointer.x < event.over.rect.left ||
    pointer.x > event.over.rect.left + event.over.rect.width ||
    pointer.y < event.over.rect.top ||
    pointer.y > event.over.rect.top + event.over.rect.height
  ) {
    return null
  }
  const fallback = resolveTabInsertion(event, isTabDragData, () => pointer)
  return fallback?.groupId === strip.groupId &&
    !isUnchangedInsertion(activeData, fallback, tabOrder)
    ? fallback
    : null
}

function isUnchangedInsertion(
  activeData: TabDragItemData,
  insertion: HoveredTabInsertion,
  tabOrder?: readonly string[]
): boolean {
  if (activeData.groupId !== insertion.groupId || !tabOrder) {
    return false
  }
  const activeIndex = tabOrder.indexOf(activeData.unifiedTabId)
  const targetIndex = tabOrder.indexOf(insertion.unifiedTabId)
  if (activeIndex === -1 || targetIndex === -1) {
    return false
  }
  const slot = targetIndex + (insertion.side === 'right' ? 1 : 0)
  return slot === activeIndex || slot === activeIndex + 1
}

export function resolveTabIndicatorEdges(
  orderedVisibleTabIds: string[],
  hoveredTabInsertion: HoveredTabInsertion | null
): TabIndicatorEdge[] {
  if (!hoveredTabInsertion || orderedVisibleTabIds.length === 0) {
    return []
  }

  const hoveredIndex = orderedVisibleTabIds.indexOf(hoveredTabInsertion.visibleTabId)
  if (hoveredIndex === -1) {
    return []
  }

  const insertionIndex = hoveredIndex + (hoveredTabInsertion.side === 'right' ? 1 : 0)
  if (insertionIndex < orderedVisibleTabIds.length) {
    return [{ visibleTabId: orderedVisibleTabIds[insertionIndex]!, side: 'left' }]
  }
  return [{ visibleTabId: orderedVisibleTabIds[insertionIndex - 1]!, side: 'right' }]
}

function equal(a: HoveredTabInsertion | null, b: HoveredTabInsertion | null): boolean {
  if (a === b) {
    return true
  }
  return (
    a !== null &&
    b !== null &&
    a.groupId === b.groupId &&
    a.unifiedTabId === b.unifiedTabId &&
    a.visibleTabId === b.visibleTabId &&
    a.side === b.side
  )
}

export function useHoveredTabInsertion(): {
  hoveredTabInsertion: HoveredTabInsertion | null
  current: () => HoveredTabInsertion | null
  set: (next: HoveredTabInsertion | null) => void
  clear: () => void
} {
  const [hoveredTabInsertion, setHoveredTabInsertion] = useState<HoveredTabInsertion | null>(null)
  const currentInsertionRef = useRef<HoveredTabInsertion | null>(null)
  const set = useCallback((next: HoveredTabInsertion | null) => {
    currentInsertionRef.current = next
    setHoveredTabInsertion((prev) => (equal(prev, next) ? prev : next))
  }, [])
  const clear = useCallback(() => {
    currentInsertionRef.current = null
    setHoveredTabInsertion(null)
  }, [])
  const current = useCallback(() => currentInsertionRef.current, [])
  return { hoveredTabInsertion, current, set, clear }
}
