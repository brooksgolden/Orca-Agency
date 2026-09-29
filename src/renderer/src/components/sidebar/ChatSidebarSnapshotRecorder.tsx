import { useEffect, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '@/store'
import { useNow } from '@/hooks/use-now'
import { buildChatSidebarRows } from './chat-sidebar-rows'
import { chatSidebarPreferencePatch } from './chat-sidebar-identity'
import { updateChatSidebar } from './chat-sidebar-preferences'
import { selectChatSidebarState } from './use-chat-sidebar-data'

/**
 * Keeps recording live Claude and Codex chats while the chat list is not mounted (sidebar collapsed
 * or Activity open), so a chat closed then still has a snapshot. No history scan runs here.
 */
export default function ChatSidebarSnapshotRecorder(): null {
  const state = useAppStore(useShallow(selectChatSidebarState))
  const now = useNow(60_000)
  const rows = useMemo(() => buildChatSidebarRows(state, [], now, undefined, true), [state, now])
  useEffect(() => {
    void updateChatSidebar((current) =>
      chatSidebarPreferencePatch(rows, current, Date.now(), { liveOnly: true })
    )
  }, [rows])
  return null
}
