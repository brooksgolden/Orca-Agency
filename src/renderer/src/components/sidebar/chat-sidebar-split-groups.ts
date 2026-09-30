import { collectWorkspaceIds, type WorkspaceSplitGroup } from '@/lib/workspace-split-layout'
import { compareChatSidebarRows } from './chat-sidebar-rows'
import type { ChatSidebarRow } from './chat-sidebar-types'

export type ChatWorkspaceGroup = {
  id: string
  members: ChatSidebarRow[]
}

/** Keep split windows together; do not infer links from shared folders or host-ambiguous IDs. */
export function chatSidebarSplitGroups(
  groups: ChatWorkspaceGroup[],
  splits: readonly WorkspaceSplitGroup[],
  groupBy: 'recent' | 'status' | 'folder'
) {
  const hosts = new Map<string, Set<string>>()
  for (const group of groups) {
    const row = group.members[0]
    if (!row.tabId) {
      continue
    }
    const known = hosts.get(row.worktree.id) ?? new Set<string>()
    known.add(row.hostId)
    hosts.set(row.worktree.id, known)
  }
  const links = new Map<string, { id: string; order: number }>()
  for (const split of splits) {
    const ids = collectWorkspaceIds(split.layout).filter((id) => hosts.get(id)?.size === 1)
    if (ids.length < 2) {
      continue
    }
    ids.forEach((id, order) => links.set(id, { id: split.id, order }))
  }
  const sets = new Map<string, { splitId?: string; groups: ChatWorkspaceGroup[] }>()
  for (const group of groups) {
    const row = group.members[0]
    const link = row.tabId ? links.get(row.worktree.id) : undefined
    const key = link ? `split:${link.id}` : group.id
    const set = sets.get(key) ?? { splitId: link?.id, groups: [] }
    set.groups.push(group)
    sets.set(key, set)
  }
  return [...sets.values()]
    .map((set) => {
      if (set.splitId) {
        set.groups.sort(
          (a, b) =>
            (links.get(a.members[0].worktree.id)?.order ?? 0) -
            (links.get(b.members[0].worktree.id)?.order ?? 0)
        )
      }
      const members = set.groups.flatMap((group) => group.members)
      const latest = [...members].sort(compareChatSidebarRows)[0]
      const folders = [...new Set(members.map((row) => row.folder))]
      const section =
        groupBy === 'folder'
          ? folders.length === 1
            ? folders[0]
            : 'Split workspaces'
          : members.every((row) => row.completed)
            ? 'Done'
            : 'In progress'
      return { ...set, latest, section }
    })
    .sort((a, b) => compareChatSidebarRows(a.latest, b.latest))
}
