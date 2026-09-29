import { useAppStore } from '@/store'
import { getNewWorkspaceProjectGroupHostId } from '@/lib/new-workspace-project-options'
import {
  getRepoExecutionHostId,
  parseExecutionHostId,
  type ExecutionHostId
} from '../../../../shared/execution-host'
import { folderWorkspaceToWorktree } from '../../../../shared/folder-workspace-worktree'
import { normalizeRuntimePathForComparison } from '../../../../shared/cross-platform-path'
import { chatSidebarWorktrees } from './chat-sidebar-rows'
import type { ChatSidebarRow, ChatSidebarState } from './chat-sidebar-types'
import { setChatFolder } from './chat-sidebar-preferences'
import { basename } from '@/lib/path'
import { chatCreationFolders } from './chat-creation-folders'

const isSamePath = (a: string, b: string) =>
  normalizeRuntimePathForComparison(a) === normalizeRuntimePathForComparison(b)

export type ChatFolderDestination = {
  id: string
  label: string
  path: string
  hostId: ExecutionHostId
  projectGroupId?: string
  worktreeId?: string
}

export function chatFolderDestinations(
  state: Pick<ChatSidebarState, 'projectGroups' | 'repos' | 'worktreesByRepo' | 'folderWorkspaces'>
): ChatFolderDestination[] {
  const groups: ChatFolderDestination[] = chatCreationFolders(state.projectGroups).flatMap(
    (group) =>
      group.parentPath
        ? [
            {
              id: `group:${group.id}`,
              label: group.name,
              path: group.parentPath,
              hostId: getNewWorkspaceProjectGroupHostId(group),
              projectGroupId: group.id
            }
          ]
        : []
  )
  const worktrees = chatSidebarWorktrees(state)
  for (const repo of state.repos) {
    if (
      groups.some(
        (group) =>
          (group.projectGroupId === repo.projectGroupId || isSamePath(group.path, repo.path)) &&
          group.hostId === getRepoExecutionHostId(repo)
      )
    ) {
      continue
    }
    const worktree = worktrees.find(
      (item) => item.repoId === repo.id && !item.isArchived && isSamePath(item.path, repo.path)
    )
    if (worktree) {
      groups.push({
        id: `repo:${repo.id}`,
        label: basename(repo.path) || repo.path,
        path: repo.path,
        hostId: getRepoExecutionHostId(repo),
        worktreeId: worktree.id
      })
    }
  }
  return groups.sort((a, b) => a.label.localeCompare(b.label))
}

export async function changeChatFolder(row: ChatSidebarRow, destination: ChatFolderDestination) {
  if (destination.hostId !== row.hostId) {
    throw new Error('Choose a folder on the same computer as this chat.')
  }
  const state = useAppStore.getState()
  if (destination.projectGroupId) {
    const existing = state.folderWorkspaces.find(
      (item) =>
        !item.isArchived &&
        item.projectGroupId === destination.projectGroupId &&
        (item.executionHostId ??
          (item.connectionId ? `ssh:${encodeURIComponent(item.connectionId)}` : 'local')) ===
          row.hostId &&
        isSamePath(item.folderPath, destination.path)
    )
    const host = parseExecutionHostId(row.hostId)
    const workspace =
      existing ??
      (await state.createFolderWorkspace(
        {
          projectGroupId: destination.projectGroupId,
          name: destination.label,
          folderPath: destination.path,
          connectionId: host?.kind === 'ssh' ? host.targetId : null
        },
        { runtimeEnvironmentId: host?.kind === 'runtime' ? host.environmentId : null }
      ))
    if (!workspace) {
      throw new Error('Could not open that folder.')
    }
    await setChatFolder(row, folderWorkspaceToWorktree(workspace))
    return
  }
  const worktree = chatSidebarWorktrees(state).find(
    (item) => item.id === destination.worktreeId && !item.isArchived
  )
  if (!worktree) {
    throw new Error('That folder is no longer available. Choose another folder.')
  }
  await setChatFolder(row, worktree)
}
