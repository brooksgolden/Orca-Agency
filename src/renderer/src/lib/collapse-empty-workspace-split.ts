import type { AppState } from '@/store/types'
import { findWorkspaceSplitPartner } from './workspace-split-layout'
import { parseWorkspaceKey } from '../../../shared/workspace-scope'

/** Called only after a user close has succeeded, including host-owned terminal closes. */
export function collapseEmptyWorkspaceSplit(
  state: AppState,
  worktreeId: string,
  closedConversationTab = false
): boolean {
  const partner = findWorkspaceSplitPartner(state.workspaceSplitGroups, worktreeId)
  const tabs = state.unifiedTabsByWorktree[worktreeId] ?? []
  const hasRemainingContent = closedConversationTab
    ? tabs.some((tab) => tab.contentType === 'terminal' || tab.contentType === 'agent-session')
    : tabs.length > 0 ||
      (state.browserTabsByWorktree[worktreeId] ?? []).length > 0 ||
      state.openFiles.some((file) => file.worktreeId === worktreeId)
  if (!partner || hasRemainingContent || (state.tabsByWorktree[worktreeId] ?? []).length > 0) {
    return false
  }
  state.unsplitWorkspace(worktreeId)
  if (state.activeWorktreeId === worktreeId || state.activeWorktreeId === null) {
    const scope = parseWorkspaceKey(partner)
    if (scope?.type === 'folder') {
      state.setActiveFolderWorkspace(scope.folderWorkspaceId)
    } else {
      state.setActiveWorktree(scope?.type === 'worktree' ? scope.worktreeId : partner)
    }
  }
  return true
}
