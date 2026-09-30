import { useAppStore } from '@/store'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { ChatSidebarRow } from './chat-sidebar-types'
import type { Worktree } from '../../../../shared/worktree/types'
import { updateChatSidebarSettings } from '@/lib/chat-sidebar-settings-update'
import { chatWorkspaceFolderKey } from './chat-sidebar-workspace-folder'
import { chatCompletionEdit } from './chat-sidebar-identity'

type Preferences = NonNullable<GlobalSettings['chatSidebar']>

export function updateChatSidebar(
  patch: Partial<Preferences> | ((current: Preferences) => Partial<Preferences> | null)
) {
  return updateChatSidebarSettings(useAppStore.getState, patch)
}

export function setChatCompleted(row: ChatSidebarRow, completed: boolean) {
  return updateChatSidebar((current) => chatCompletionEdit(row, current, completed, Date.now()))
}

export function setChatSidebarTitle(row: Pick<ChatSidebarRow, 'id' | 'aliases'>, title: string) {
  return updateChatSidebar((current) => {
    const titles = { ...current.titles }
    // Why: a name left under an earlier id would resurface when this one is cleared.
    for (const id of [row.id, ...row.aliases]) {
      delete titles[id]
    }
    if (title.trim()) {
      titles[row.id] = title.trim()
    }
    return { titles }
  })
}

export function setChatFolder(row: ChatSidebarRow, destination: Worktree) {
  return updateChatSidebar((current) => {
    const folderAssignments = { ...current.folderAssignments }
    for (const id of [row.id, ...row.aliases]) {
      delete folderAssignments[id]
    }
    folderAssignments[row.id] = { worktreeId: destination.id, executionHostId: row.hostId }
    return {
      folderAssignments,
      ...(row.tabId
        ? {
            workspaceFolderAssignments: {
              ...current.workspaceFolderAssignments,
              [chatWorkspaceFolderKey(row)]: folderAssignments[row.id]
            }
          }
        : {})
    }
  })
}
