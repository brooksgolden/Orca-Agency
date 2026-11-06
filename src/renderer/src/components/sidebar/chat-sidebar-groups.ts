import {
  chatHasWorkingTurn,
  type ChatSidebarRow,
  type ChatSidebarState
} from './chat-sidebar-types'
import {
  chatInCheckedState,
  resolveCollapseFolders,
  resolveHideChats
} from './chat-sidebar-chat-filters'
import { chatCreationFolders, hiddenChatFolderLabels } from './chat-creation-folders'
import { chatSidebarSplitGroups, type FocusedChatWorkspace } from './chat-sidebar-split-groups'
import type { WorkspaceSplitGroup } from '@/lib/workspace-split-layout'
import { chatSidebarPaneGroups, type ChatPaneLayout } from './chat-sidebar-pane-groups'

export type ChatSidebarListItem =
  | {
      kind: 'heading'
      label: string
      id: string
      collapsed: boolean
      doneFolder?: string
      workingChatIds?: string[]
      splitChatIds?: string[]
    }
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

/** Activity orders workspaces; resident tab order determines each pane's parent chat. */
export function chatSidebarListItems(
  rows: readonly ChatSidebarRow[],
  state: Pick<
    ChatSidebarState,
    'tabsByWorktree' | 'unifiedTabsByWorktree' | 'projectGroups' | 'settings'
  > &
    ChatPaneLayout,
  query: string,
  splits: readonly WorkspaceSplitGroup[] = [],
  collapsedGroups?: ReadonlySet<string>,
  focused?: FocusedChatWorkspace,
  /** Tabs on screen now; an idle chat in one of them stays visible. */
  visibleTabIds?: ReadonlySet<string>
): ChatSidebarListItem[] {
  const settings = state.settings?.chatSidebar
  const groupBy = settings?.groupBy ?? 'status'
  const hide = resolveHideChats(settings)
  const collapse = resolveCollapseFolders(settings)
  const collapseEnabled = collapse.doneClosed || collapse.doneOpen || collapse.idle
  const hideEnabled = hide.doneClosed || hide.doneOpen || hide.idle
  const keepEmptyFolders = !settings?.showOnlyOpenChats || hideEnabled
  const text = query.trim().toLocaleLowerCase()
  const hiddenFolders = hiddenChatFolderLabels(settings?.hiddenFolders, state.projectGroups)
  const matches = (row: ChatSidebarRow) =>
    `${row.title}\n${row.folder}`.toLocaleLowerCase().includes(text)
  const byWorkspace = new Map<string, ChatSidebarRow[]>()
  const folderCompletion = new Map<string, boolean>()
  // Why: a folder whose chats were all hidden by Done or idle keeps its empty heading, as Done folders do.
  const folderFilteredOut = new Map<string, boolean>()
  // Why: a folder collapses only when every chat in it is in a checked Collapse Folders state.
  const folderAllChecked = new Map<string, boolean>()
  for (const row of rows) {
    if (!row.automated) {
      folderCompletion.set(row.folder, (folderCompletion.get(row.folder) ?? true) && row.completed)
      const filteredOut = chatInCheckedState(row, hide, visibleTabIds)
      folderFilteredOut.set(row.folder, (folderFilteredOut.get(row.folder) ?? true) && filteredOut)
    }
  }
  const registeredFolders = chatCreationFolders(state.projectGroups).map((folder) => folder.name)
  for (const row of rows) {
    if (
      row.automated ||
      hiddenFolders.includes(row.folder) ||
      chatInCheckedState(row, hide, visibleTabIds) ||
      (settings?.showOnlyOpenChats && !row.tabId)
    ) {
      continue
    }
    const key = JSON.stringify([
      row.hostId,
      row.worktree.id,
      groupBy === 'folder' ? row.folder : null,
      // Why: opening Done beside active work must not promote it without a new prompt.
      groupBy === 'status' ? row.completed : null,
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
    const members = [...siblings].sort((a, b) => {
      const aOrder = order.get(a.tabId ?? '')
      const bOrder = order.get(b.tabId ?? '')
      if (aOrder !== undefined || bOrder !== undefined) {
        const difference = (aOrder ?? Number.MAX_SAFE_INTEGER) - (bOrder ?? Number.MAX_SAFE_INTEGER)
        if (difference !== 0) {
          return difference
        }
      }
      return (
        Number(b.ownsWorkspaceName) - Number(a.ownsWorkspaceName) ||
        createdAt(a) - createdAt(b) ||
        a.id.localeCompare(b.id)
      )
    })
    return { id, members }
  })
  const workspaceSections = chatSidebarSplitGroups(
    chatSidebarPaneGroups(groups, state),
    splits,
    groupBy,
    focused
  )
  const separatelyGroupedRows = new Set(
    workspaceSections.flatMap((section) =>
      section.groups.flatMap((group) =>
        group.members.filter((row) => section.section !== row.folder).map((row) => row.id)
      )
    )
  )
  for (const row of rows) {
    if (!row.automated && !separatelyGroupedRows.has(row.id)) {
      const checked = chatInCheckedState(row, collapse, visibleTabIds)
      folderAllChecked.set(row.folder, (folderAllChecked.get(row.folder) ?? true) && checked)
    }
  }
  const joined = workspaceSections
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
  const visibleFolders = new Set(
    joined.flatMap((set) => set.groups.flatMap((group) => group.members.map((row) => row.folder)))
  )
  const emptiedFolders = new Set(
    [...folderFilteredOut].filter(([, filteredOut]) => filteredOut).map(([folder]) => folder)
  )
  const keys =
    groupBy === 'status'
      ? ['In progress', 'Done']
      : groupBy === 'folder'
        ? [
            ...new Set([
              ...sections.keys(),
              ...(keepEmptyFolders ? [...folderCompletion.keys(), ...emptiedFolders] : []).filter(
                (folder) =>
                  !hiddenFolders.includes(folder) &&
                  !visibleFolders.has(folder) &&
                  (!text || folder.toLocaleLowerCase().includes(text))
              ),
              ...(keepEmptyFolders ? registeredFolders : []).filter(
                (folder) =>
                  !hiddenFolders.includes(folder) &&
                  !visibleFolders.has(folder) &&
                  (!text || folder.toLocaleLowerCase().includes(text))
              )
            ])
          ]
        : [...sections.keys()]
  return keys.flatMap((key): ChatSidebarListItem[] => {
    const section = sections.get(key) ?? []
    if (
      !section.length &&
      (groupBy !== 'folder' ||
        !keepEmptyFolders ||
        (!folderCompletion.has(key) &&
          !emptiedFolders.has(key) &&
          !registeredFolders.includes(key)))
    ) {
      return []
    }
    const headingId = `chat:${groupBy}:${key}`
    const doneFolder =
      groupBy === 'folder' && collapseEnabled && folderAllChecked.get(key) ? key : undefined
    const sectionRows = section.flatMap((set) => set.groups.flatMap((group) => group.members))
    const revealEnabled = groupBy === 'folder' && collapseEnabled
    const workingChatIds = revealEnabled
      ? sectionRows
          .filter((row) => row.folder === key && !row.completed && chatHasWorkingTurn(row))
          .map((row) => row.id)
      : undefined
    const splitChatIds =
      revealEnabled && key === 'Split workspaces' ? sectionRows.map((row) => row.id) : undefined
    const collapsed =
      (collapsedGroups?.has(headingId) ?? false) ||
      (doneFolder !== undefined && !settings?.expandedDoneFolders?.includes(doneFolder))
    const label = groupBy === 'status' && key === 'In progress' ? 'In Progress' : key
    const items: ChatSidebarListItem[] = key
      ? [
          {
            kind: 'heading',
            id: headingId,
            collapsed,
            doneFolder,
            workingChatIds,
            splitChatIds,
            label: `${label} (${section.reduce((sum, set) => sum + set.groups.reduce((count, group) => count + group.members.length, 0), 0)})`
          }
        ]
      : []
    if (collapsed && key) {
      return items
    }
    for (const set of section) {
      const start = items.length
      for (const group of set.groups) {
        const members = group.members
        members.forEach((row, index) =>
          items.push({
            kind: 'chat',
            row,
            id: row.id,
            groupId: group.id,
            subTab: index > 0,
            showFolder: index === members.length - 1,
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
