import type { AppState } from '@/store/types'
import type { ChatSidebarSettings } from '../../../shared/chat-sidebar-settings'
import { updateChatSidebarSettings } from './chat-sidebar-settings-update'
import { buildChatSidebarRows } from '@/components/sidebar/chat-sidebar-rows'
import { chatSidebarPreferencePatch } from '@/components/sidebar/chat-sidebar-identity'
import type { ChatSidebarRow } from '@/components/sidebar/chat-sidebar-types'

export function closedChatSidebarPatch(
  closing: readonly ChatSidebarRow[],
  remaining: readonly ChatSidebarRow[],
  current: ChatSidebarSettings,
  now: number
): Partial<ChatSidebarSettings> {
  const patch = chatSidebarPreferencePatch(closing, current, now) ?? {}
  const completed = { ...current.completed, ...patch.completed }
  const folderAssignments = { ...current.folderAssignments, ...patch.folderAssignments }
  for (const row of closing) {
    // Why: closing one duplicate must not mark another still-open copy of that chat done.
    if (
      remaining.some(
        (other) => other.tabId && row.sessionKey && other.sessionKey === row.sessionKey
      )
    ) {
      continue
    }
    const id = row.sessionKey ?? row.id
    completed[id] = { at: now, activityAt: row.timestamp, done: true }
    if (row.folderWorktree) {
      folderAssignments[id] = { worktreeId: row.folderWorktree.id, executionHostId: row.hostId }
    }
  }
  return { ...patch, completed, folderAssignments }
}

/** Capture before retirement erases provider metadata; persist after the synchronous close. */
export function completeClosedChatTab(get: () => AppState, tabId: string): void {
  const now = Date.now()
  const closing = buildChatSidebarRows(get(), [], now, undefined, true).filter(
    (row) => row.tabId === tabId
  )
  if (!closing.length) {
    return
  }
  void updateChatSidebarSettings(get, (current) =>
    closedChatSidebarPatch(
      closing,
      buildChatSidebarRows(get(), [], now, undefined, true),
      current,
      now
    )
  ).catch((error: unknown) => console.error('Could not save closed chat status', error))
}
