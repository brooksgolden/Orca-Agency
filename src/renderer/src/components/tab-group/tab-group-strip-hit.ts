import { escapeCssAttrValue } from './tab-group-panel-split-target'

export type TabGroupStripTabHit = {
  unifiedTabId: string
  visibleTabId: string
  rect: DOMRect
}

export type TabGroupStripHit = {
  groupId: string
  stripRect: DOMRect
  blocked: boolean
  tabAtPointer: TabGroupStripTabHit | null
  nextTab: TabGroupStripTabHit | null
  lastTab: TabGroupStripTabHit | null
}

export function findTabGroupStripUnderPointer(
  worktreeId: string,
  pointer: { x: number; y: number }
): TabGroupStripHit | null {
  const escapedWorktreeId = escapeCssAttrValue(worktreeId)
  const strips = document.querySelectorAll<HTMLElement>(
    `[data-tab-group-strip-id][data-worktree-id="${escapedWorktreeId}"]`
  )
  for (const strip of strips) {
    const groupId = strip.dataset.tabGroupStripId
    const stripRect = strip.getBoundingClientRect()
    if (
      groupId &&
      pointer.x >= stripRect.left &&
      pointer.x <= stripRect.right &&
      pointer.y >= stripRect.top &&
      pointer.y <= stripRect.bottom
    ) {
      const topElement = document.elementFromPoint?.(pointer.x, pointer.y)
      if (topElement && !strip.contains(topElement)) {
        continue
      }
      const control = topElement?.closest('button,[role="button"]')
      if (control && strip.contains(control) && !control.closest('[data-tab-id]')) {
        return {
          groupId,
          stripRect,
          blocked: true,
          tabAtPointer: null,
          nextTab: null,
          lastTab: null
        }
      }
      const scrollerRect =
        strip.querySelector<HTMLElement>('.terminal-tab-strip')?.getBoundingClientRect() ??
        stripRect
      const tabs = Array.from(
        strip.querySelectorAll<HTMLElement>('[data-tab-id][data-unified-tab-id]')
      ).flatMap((tab) => {
        const visibleTabId = tab.dataset.tabId
        const unifiedTabId = tab.dataset.unifiedTabId
        const rect = tab.getBoundingClientRect()
        return visibleTabId &&
          unifiedTabId &&
          rect.right > Math.max(stripRect.left, scrollerRect.left) &&
          rect.left < Math.min(stripRect.right, scrollerRect.right)
          ? [{ visibleTabId, unifiedTabId, rect }]
          : []
      })
      const tabAtPointer =
        tabs.find(
          (tab) =>
            pointer.x >= tab.rect.left &&
            pointer.x <= tab.rect.right &&
            pointer.x >= scrollerRect.left &&
            pointer.x <= scrollerRect.right &&
            pointer.y >= tab.rect.top &&
            pointer.y <= tab.rect.bottom &&
            pointer.y >= scrollerRect.top &&
            pointer.y <= scrollerRect.bottom
        ) ?? null
      const nextTab = tabs.find((tab) => pointer.x < tab.rect.left) ?? null
      return {
        groupId,
        stripRect,
        blocked: false,
        tabAtPointer,
        nextTab,
        lastTab: tabs.at(-1) ?? null
      }
    }
  }
  return null
}
