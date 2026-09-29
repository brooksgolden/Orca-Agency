import type { ProjectGroup } from '../../../../shared/project-group-types'
import type { ChatSidebarSettings } from '../../../../shared/chat-sidebar-settings'
import { normalizeRuntimePathForComparison } from '../../../../shared/cross-platform-path'
import { getNewWorkspaceProjectGroupHostId } from '@/lib/new-workspace-project-options'
import { basename } from '@/lib/path'

export function chatCreationFolders(groups: readonly ProjectGroup[]): ProjectGroup[] {
  const folders = new Map<string, ProjectGroup>()
  for (const group of groups) {
    const path = group.parentPath?.trim()
    if (!path) {
      continue
    }
    const key = JSON.stringify([
      getNewWorkspaceProjectGroupHostId(group),
      normalizeRuntimePathForComparison(path)
    ])
    if (!folders.has(key)) {
      folders.set(key, { ...group, parentPath: path, name: basename(path) || path })
    }
  }
  return [...folders.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export function chatFolderKey(folder: ProjectGroup): string {
  return JSON.stringify([getNewWorkspaceProjectGroupHostId(folder), folder.id])
}

export function defaultChatFolder(
  folders: readonly ProjectGroup[],
  preference: ChatSidebarSettings['defaultFolder']
): ProjectGroup | undefined {
  return (
    folders.find(
      (folder) =>
        folder.id === preference?.projectGroupId &&
        getNewWorkspaceProjectGroupHostId(folder) === preference.executionHostId
    ) ??
    folders.find(
      (folder) =>
        folder.name.toLowerCase() === 'uncategorized' &&
        getNewWorkspaceProjectGroupHostId(folder) === 'local'
    )
  )
}

/** Old preferences used group display names; keep hidden directories hidden after relabeling. */
export function hiddenChatFolderLabels(
  labels: readonly string[] | undefined,
  groups: readonly ProjectGroup[]
): string[] {
  return [
    ...new Set(
      (labels ?? []).flatMap((label) => {
        if (chatCreationFolders(groups).some((folder) => folder.name === label)) {
          return [label]
        }
        const matches = groups.filter((group) => group.name === label && group.parentPath?.trim())
        return matches.length
          ? matches.map((group) => basename(group.parentPath!) || group.parentPath!)
          : [label]
      })
    )
  ]
}
