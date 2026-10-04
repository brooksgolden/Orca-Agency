import { useAppStore } from '@/store'
import { toast } from 'sonner'
import { buildChatSidebarRows } from '../sidebar/chat-sidebar-rows'
import { detachSidebarChat } from '../sidebar/chat-sidebar-detach'

/** Remove the view without closing its terminals or changing completion status. */
export async function removeChatPaneFromSplit(worktreeId: string, groupId: string): Promise<void> {
  const state = useAppStore.getState()
  const terminals =
    state.unifiedTabsByWorktree[worktreeId]?.filter(
      (tab) => tab.groupId === groupId && tab.contentType === 'terminal'
    ) ?? []
  for (const terminal of terminals) {
    const row = buildChatSidebarRows(useAppStore.getState(), [], Date.now()).find(
      (item) => item.worktree.id === worktreeId && item.tabId === terminal.entityId
    )
    if (row) {
      await detachSidebarChat(row, false)
    }
  }
  // Editors and blank shells stay available in the adjacent tab strip.
  useAppStore.getState().mergeGroupIntoSibling(worktreeId, groupId)
}

export function removeChatPane(worktreeId: string, groupId: string): void {
  void removeChatPaneFromSplit(worktreeId, groupId).catch((error: unknown) =>
    toast.error(error instanceof Error ? error.message : 'Could not remove pane from split.')
  )
}
