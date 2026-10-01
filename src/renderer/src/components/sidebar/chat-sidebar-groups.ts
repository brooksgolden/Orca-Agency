import type { ChatSidebarRow, ChatSidebarState } from './chat-sidebar-types'
import { hiddenChatFolderLabels } from './chat-creation-folders'
import { chatSidebarSplitGroups } from './chat-sidebar-split-groups'
import type { WorkspaceSplitGroup } from '@/lib/workspace-split-layout'
import { chatSidebarPaneGroups, type ChatPaneLayout } from './chat-sidebar-pane-groups'

export type ChatSidebarListItem =
  | { kind: 'heading'; label: string; id: string }
  | {
      kind: 'chat'
      row: ChatSidebarRow
      id: string
      groupId: string
      subTab: boolean
      showFolder: boolean
      splitId?: string
      splitStart?: boolean
      splitEnd?: boolean
    }

/** Activity orders whole workspaces; creation order keeps their main chat stable. */
export function chatSidebarListItems(
  rows: readonly ChatSidebarRow[],
  state: Pick<
    ChatSidebarState,
    'tabsByWorktree' | 'unifiedTabsByWorktree' | 'projectGroups' | 'settings'
  > &
    ChatPaneLayout,
  query: string,
  splits: readonly WorkspaceSplitGroup[] = []
): ChatSidebarListItem[] {
  const settings = state.settings?.chatSidebar
  const groupBy = settings?.groupBy ?? 'status'
  const text = query.trim().toLocaleLowerCase()
  const hiddenFolders = hiddenChatFolderLabels(settings?.hiddenFolders, state.projectGroups)
  const matches = (row: ChatSidebarRow) =>
    `${row.title}\n${row.folder}`.toLocaleLowerCase().includes(text)
  const byWorkspace = new Map<string, ChatSidebarRow[]>()
  for (const row of rows) {
    if (row.automated || hiddenFolders.includes(row.folder)) {
      continue
    }
    const key = JSON.stringify([
      row.hostId,
      row.worktree.id,
      groupBy === 'folder' ? row.folder : null,
      // Why: history belongs in the list, but only resident tabs share a visible workspace.
      row.tabId ? null : row.id
    ])
    const siblings = byWorkspace.get(key) ?? []
    siblings.push(row)
    byWorkspace.set(key, siblings)
  }
  const groups = [...byWorkspace.entries()].map(([id, siblings]) => {
    const worktreeId = siblings[0].worktree.id
    const tabs = [
      ...new Map(
        [
          ...(state.unifiedTabsByWorktree[worktreeId] ?? []),
          ...(state.tabsByWorktree[worktreeId] ?? [])
        ].map((tab) => [tab.id, tab])
      ).values()
    ]
    const order = new Map(tabs.map((tab, index) => [tab.id, index]))
    const createdAt = (row: ChatSidebarRow) =>
      tabs.find((tab) => tab.id === row.tabId)?.createdAt ??
      row.createdAt ??
      (Date.parse(row.session?.createdAt ?? '') || Number.MAX_SAFE_INTEGER)
    const members = [...siblings].sort(
      (a, b) =>
        Number(b.ownsWorkspaceName) - Number(a.ownsWorkspaceName) ||
        createdAt(a) - createdAt(b) ||
        (order.get(a.tabId ?? '') ?? Number.MAX_SAFE_INTEGER) -
          (order.get(b.tabId ?? '') ?? Number.MAX_SAFE_INTEGER) ||
        a.id.localeCompare(b.id)
    )
    return { id, members }
  })
  const joined = chatSidebarSplitGroups(chatSidebarPaneGroups(groups, state), splits, groupBy)
    .filter((set) => !text || set.groups.some((group) => group.members.some(matches)))
    .map((set) => ({
      ...set,
      groups: set.groups.map((group) => ({
        ...group,
        members: group.members.filter((row, index) => !text || index === 0 || matches(row))
      }))
    }))
  const sections = new Map<string, typeof joined>()
  for (const group of joined) {
    const key = groupBy === 'recent' ? '' : group.section
    const section = sections.get(key) ?? []
    section.push(group)
    sections.set(key, section)
  }
  const keys = groupBy === 'status' ? ['In progress', 'Done'] : [...sections.keys()]
  return keys.flatMap((key): ChatSidebarListItem[] => {
    const section = sections.get(key)
    if (!section?.length) {
      return []
    }
    const items: ChatSidebarListItem[] = key
      ? [
          {
            kind: 'heading',
            id: `heading:${key}`,
            label: `${key} (${section.reduce((sum, set) => sum + set.groups.reduce((count, group) => count + group.members.length, 0), 0)})`
          }
        ]
      : []
    for (const set of section) {
      const start = items.length
      for (const [groupIndex, group] of set.groups.entries()) {
        const members = group.members
        const next = set.groups[groupIndex + 1]
        const showFolder = !group.folderGroupId || next?.folderGroupId !== group.folderGroupId
        members.forEach((row, index) =>
          items.push({
            kind: 'chat',
            row,
            id: row.id,
            groupId: group.id,
            subTab: index > 0,
            showFolder: showFolder && index === members.length - 1,
            splitId: set.splitId
          })
        )
      }
      const first = items[start]
      const last = items.at(-1)
      if (set.splitId && first?.kind === 'chat' && last?.kind === 'chat') {
        first.splitStart = true
        last.splitEnd = true
      }
    }
    return items
  })
}

export function chatSidebarItemHeight(item: ChatSidebarListItem): number {
  if (item.kind === 'heading') {
    return 28
  }
  return item.showFolder ? 36 : 20
}
