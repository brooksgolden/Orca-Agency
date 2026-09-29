import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import { parsePaneKey } from '../../../../shared/stable-pane-id'
import type { ChatSidebarRow } from './chat-sidebar-types'

export type ActiveChatTarget = {
  worktreeId: string | null
  tabId: string | null
  leafId: string | null
}

/** The chat surface the user is looking at: the focused group's tab, not the last terminal. */
export function activeChatTarget(
  state: Pick<
    AppState,
    | 'activeWorktreeId'
    | 'activeGroupIdByWorktree'
    | 'groupsByWorktree'
    | 'unifiedTabsByWorktree'
    | 'activeTabType'
    | 'activeTabId'
    | 'terminalLayoutsByTabId'
  >
): ActiveChatTarget {
  const worktreeId = state.activeWorktreeId
  if (!worktreeId) {
    return { worktreeId: null, tabId: null, leafId: null }
  }
  const groupId = state.activeGroupIdByWorktree[worktreeId]
  const unifiedId = state.groupsByWorktree[worktreeId]?.find(
    (group) => group.id === groupId
  )?.activeTabId
  const tab = unifiedId
    ? state.unifiedTabsByWorktree[worktreeId]?.find((item) => item.id === unifiedId)
    : undefined
  const tabId = tab
    ? tab.contentType === 'terminal'
      ? tab.entityId
      : tab.contentType === 'agent-session'
        ? tab.id
        : null
    : state.activeTabType === 'terminal'
      ? state.activeTabId
      : null
  return {
    worktreeId,
    tabId,
    leafId: tabId ? (state.terminalLayoutsByTabId[tabId]?.activeLeafId ?? null) : null
  }
}

export function isChatRowSelected(
  row: Pick<ChatSidebarRow, 'worktree' | 'tabId' | 'paneKey'>,
  target: ActiveChatTarget,
  chatsInTab: number
): boolean {
  if (!row.tabId || row.worktree.id !== target.worktreeId || row.tabId !== target.tabId) {
    return false
  }
  // Why: two agents split inside one tab are separate chats; only the focused pane's is current.
  return chatsInTab < 2 || !row.paneKey || parsePaneKey(row.paneKey)?.leafId === target.leafId
}

/** Makes the chat's tab current in its own workspace, so a workspace drag carries that chat. */
export function selectChatTabInWorkspace(row: Pick<ChatSidebarRow, 'worktree' | 'tabId'>): void {
  if (!row.tabId) {
    return
  }
  const state = useAppStore.getState()
  const structured = state.unifiedTabsByWorktree[row.worktree.id]?.find(
    (tab) => tab.id === row.tabId && tab.contentType === 'agent-session'
  )
  if (structured) {
    state.activateTab(structured.id, { worktreeId: row.worktree.id })
  } else {
    state.setActiveTab(row.tabId)
  }
}
