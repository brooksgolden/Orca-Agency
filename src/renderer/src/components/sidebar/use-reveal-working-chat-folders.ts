import { useEffect, useRef } from 'react'
import { useAppStore } from '@/store'
import type { ChatSidebarListItem } from './chat-sidebar-groups'

/** Reveal newly working folder sections once; subsequent manual collapse wins. */
export function useRevealWorkingChatFolders(items: readonly ChatSidebarListItem[], query: string) {
  const previous = useRef<Set<string> | null>(null)
  useEffect(() => {
    if (query.trim()) {
      return
    }
    const working = new Set(
      items.flatMap((item) =>
        item.kind === 'heading' && item.workingFolder !== undefined ? [item.id] : []
      )
    )
    const state = useAppStore.getState()
    for (const id of working) {
      if (previous.current && !previous.current.has(id) && state.collapsedGroups.has(id)) {
        state.toggleCollapsedGroup(id)
      }
    }
    previous.current = working
  }, [items, query])
}
