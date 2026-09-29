import type { Worktree } from '../../../../shared/worktree/types'
import type { ChatSidebarRow, ChatSidebarState } from './chat-sidebar-types'

/** A workspace name the user chose, not one that follows its branch, folder or project. */
export function manualWorkspaceName(
  state: Pick<ChatSidebarState, 'repos'>,
  worktree: Worktree
): string | null {
  const name = worktree.displayName?.trim()
  if (!name || worktree.displayNameMode === 'automatic') {
    return null
  }
  const repoName = state.repos.find((repo) => repo.id === worktree.repoId)?.displayName
  const folderName = worktree.path.split(/[\\/]/).findLast(Boolean)
  const branchName = worktree.branch?.replace(/^refs\/heads\//, '')
  return name === folderName || name === repoName || name === branchName ? null : name
}

/** The one chat per workspace that shows the workspace's manual name. */
export function chatWorkspaceNameOwners(
  state: Pick<ChatSidebarState, 'repos' | 'settings'>,
  rows: readonly ChatSidebarRow[]
): Map<string, ChatSidebarRow> {
  const registered = new Map<string, string>()
  for (const [key, entry] of Object.entries(state.settings?.chatSidebar?.sessions ?? {})) {
    if (entry.ownsWorkspaceName && !registered.has(entry.worktreeId)) {
      registered.set(entry.worktreeId, key)
    }
  }
  const byWorktree = new Map<string, ChatSidebarRow[]>()
  for (const row of rows) {
    byWorktree.set(row.worktree.id, [...(byWorktree.get(row.worktree.id) ?? []), row])
  }
  const owners = new Map<string, ChatSidebarRow>()
  for (const [worktreeId, group] of byWorktree) {
    if (!manualWorkspaceName(state, group[0].worktree)) {
      continue
    }
    const registeredKey = registered.get(worktreeId)
    // Why: once pinned, later sibling chats and history imports must not move or hide the name.
    const resident = group.filter((row) => row.tabId)
    const candidates = registeredKey
      ? group.filter((row) => row.id === registeredKey)
      : resident.length > 0
        ? resident
        : group
    if (candidates.length === 1) {
      owners.set(worktreeId, candidates[0])
    }
  }
  return owners
}
