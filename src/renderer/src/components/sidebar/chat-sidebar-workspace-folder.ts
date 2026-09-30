import type { ChatSidebarSettings } from '../../../../shared/chat-sidebar-settings'
import type { Worktree } from '../../../../shared/worktree/types'
import type { ChatSidebarRow } from './chat-sidebar-types'
import { chatPreference } from './chat-sidebar-identity'

export function chatWorkspaceFolderKey(row: Pick<ChatSidebarRow, 'hostId' | 'worktree'>): string {
  return JSON.stringify([row.hostId, row.worktree.id])
}

/** A workspace has one filing destination; historical chats can be filed independently. */
export function chatWorkspaceFolders(
  rows: readonly ChatSidebarRow[],
  settings: ChatSidebarSettings | undefined,
  worktrees: ReadonlyMap<string, Worktree>,
  hostOf: (worktree: Worktree) => string,
  tabCreatedAt: ReadonlyMap<string, number>
): Map<string, Worktree> {
  const assignments = new Map<string, Worktree>()
  const valid = (
    assignment: NonNullable<ChatSidebarSettings['folderAssignments']>[string] | undefined,
    row: ChatSidebarRow
  ) => {
    const target = assignment && worktrees.get(assignment.worktreeId)
    return target &&
      !target.isArchived &&
      assignment.executionHostId === row.hostId &&
      hostOf(target) === row.hostId
      ? target
      : undefined
  }
  const resident = rows
    .filter((row) => row.tabId)
    .sort(
      (a, b) =>
        (tabCreatedAt.get(a.tabId!) ?? 0) - (tabCreatedAt.get(b.tabId!) ?? 0) ||
        a.id.localeCompare(b.id)
    )
  for (const row of resident) {
    const key = chatWorkspaceFolderKey(row)
    const target =
      valid(settings?.workspaceFolderAssignments?.[key], row) ??
      valid(chatPreference(settings?.folderAssignments, row), row)
    if (target && !assignments.has(key)) {
      assignments.set(key, target)
    }
  }
  return new Map(
    rows.flatMap((row) => {
      const target = row.tabId
        ? assignments.get(chatWorkspaceFolderKey(row))
        : (valid(chatPreference(settings?.folderAssignments, row), row) ??
          valid(settings?.workspaceFolderAssignments?.[chatWorkspaceFolderKey(row)], row))
      return target ? [[row.id, target] as const] : []
    })
  )
}
