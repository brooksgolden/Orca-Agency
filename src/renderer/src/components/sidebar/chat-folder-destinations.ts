import { useAppStore } from '@/store'
import { getNewWorkspaceProjectGroupHostId } from '@/lib/new-workspace-project-options'
import {
  getWorktreeExecutionHostId,
  parseExecutionHostId,
  type ExecutionHostId
} from '../../../../shared/execution-host'
import { folderWorkspaceToWorktree } from '../../../../shared/folder-workspace-worktree'
import { normalizeRuntimePathForComparison } from '../../../../shared/cross-platform-path'
import type { ProjectGroup } from '../../../../shared/project-group-types'
import { buildChatSidebarRows } from './chat-sidebar-rows'
import { chatFolderLabel, chatSidebarWorktrees } from './chat-sidebar-worktrees'
import type { ChatSidebarRow, ChatSidebarState } from './chat-sidebar-types'
import { setChatFolder } from './chat-sidebar-preferences'
import { chatCreationFolders, hiddenChatFolderLabels } from './chat-creation-folders'

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

type ChatFolderDestinationState = Pick<
  ChatSidebarState,
  'projectGroups' | 'repos' | 'worktreesByRepo' | 'folderWorkspaces'
>

const UNREGISTERED_FOLDER_ID_PREFIX = 'unregistered-folder:'

export type ChatFolderDestinationOptions = {
  /**
   * Allowed sidebar headings, excluding explicitly hidden folders. Non-main worktrees
   * (for example a branch checkout) appear only with a matching heading.
   */
  headingLabels?: ReadonlySet<string>
}

/**
 * The single list of folders a chat can be filed under, shared by the Change folder menu and the
 * new-chat and new-workspace pickers. Entries are: registered project groups, every registered
 * project's main worktree (labelled by the same `chatFolderLabel` the sidebar heading uses), and
 * any other worktree whose heading is currently shown. One entry per host and label, so a
 * heading never appears twice and choosing one files the chat under that same heading.
 */
export function chatFolderDestinations(
  state: ChatFolderDestinationState,
  options: ChatFolderDestinationOptions = {}
): ChatFolderDestination[] {
  const entries = new Map<string, ChatFolderDestination>()
  const add = (entry: ChatFolderDestination) => {
    const key = JSON.stringify([entry.hostId, entry.label])
    if (!entries.has(key)) {
      entries.set(key, entry)
    }
  }
  for (const group of chatCreationFolders(state.projectGroups)) {
    if (options.headingLabels && !options.headingLabels.has(group.name)) {
      continue
    }
    add({
      id: `group:${group.id}`,
      label: group.name,
      path: group.parentPath ?? '',
      hostId: getNewWorkspaceProjectGroupHostId(group),
      projectGroupId: group.id
    })
  }
  const repoById = new Map(state.repos.map((repo) => [repo.id, repo]))
  const worktrees = chatSidebarWorktrees(state).filter(
    (worktree) => !worktree.isArchived && Boolean(worktree.path)
  )
  const toDestination = (worktree: (typeof worktrees)[number]): ChatFolderDestination => ({
    id: `worktree:${worktree.id}`,
    label: chatFolderLabel(state, worktree),
    path: worktree.path,
    hostId: getWorktreeExecutionHostId(worktree, repoById.get(worktree.repoId)),
    worktreeId: worktree.id
  })
  // Registered projects: the main checkout of each repo, at the repo's own path. Separators and
  // case are folded by isSamePath, so a Windows path spelled with / or \ still matches.
  const isMainCheckout = (worktree: (typeof worktrees)[number]) => {
    const repo = repoById.get(worktree.repoId)
    return (
      Boolean(repo) && (worktree.isMainWorktree === true || isSamePath(worktree.path, repo!.path))
    )
  }
  for (const worktree of worktrees) {
    if (isMainCheckout(worktree)) {
      const destination = toDestination(worktree)
      if (!options.headingLabels || options.headingLabels.has(destination.label)) {
        add(destination)
      }
    }
  }
  // Other worktrees (branch checkouts, nested workspaces, folder workspaces) add an entry only
  // when the sidebar is showing their heading, so a branch name never becomes a menu entry.
  for (const worktree of worktrees) {
    if (isMainCheckout(worktree)) {
      continue
    }
    const destination = toDestination(worktree)
    if (options.headingLabels?.has(destination.label)) {
      add(destination)
    }
  }
  return [...entries.values()].sort((a, b) => a.label.localeCompare(b.label))
}

/** Folder headings represented by saved or resident human chats, plus registered empty folders. */
export function chatFolderHeadingLabels(
  state: ChatSidebarState,
  now = Date.now(),
  rows?: readonly Pick<ChatSidebarRow, 'folder'>[]
): ReadonlySet<string> {
  const hidden = new Set(
    hiddenChatFolderLabels(state.settings?.chatSidebar?.hiddenFolders, state.projectGroups)
  )
  return new Set(
    [
      ...chatCreationFolders(state.projectGroups).map((folder) => folder.name),
      ...(rows ?? buildChatSidebarRows(state, [], now)).map((row) => row.folder)
    ].filter((label) => !hidden.has(label))
  )
}

/**
 * The same destinations as project-group rows for the new-chat and new-workspace pickers. A folder
 * that exists only as a worktree heading is represented by an unregistered group, which is
 * registered when chosen (see `registerChatFolderGroup`).
 */
export function chatFolderPickerGroups(
  state: ChatFolderDestinationState,
  options: ChatFolderDestinationOptions = {}
): ProjectGroup[] {
  const registered = chatCreationFolders(state.projectGroups)
  return chatFolderDestinations(state, options).flatMap((destination): ProjectGroup[] => {
    if (destination.projectGroupId) {
      const group = registered.find((item) => item.id === destination.projectGroupId)
      return group ? [group] : []
    }
    return [
      {
        id: `${UNREGISTERED_FOLDER_ID_PREFIX}${destination.hostId}:${destination.path}`,
        name: destination.label,
        parentPath: destination.path,
        connectionId: null,
        executionHostId: destination.hostId,
        parentGroupId: null,
        createdFrom: 'manual',
        tabOrder: 0,
        isCollapsed: false,
        color: null,
        createdAt: 0,
        updatedAt: 0
      }
    ]
  })
}

export function isUnregisteredChatFolder(folder: Pick<ProjectGroup, 'id'>): boolean {
  return folder.id.startsWith(UNREGISTERED_FOLDER_ID_PREFIX)
}

/** Adds an unregistered worktree folder to the project-group list, reusing an existing match. */
export async function registerChatFolderGroup(folder: ProjectGroup): Promise<ProjectGroup | null> {
  const state = useAppStore.getState()
  const hostId = getNewWorkspaceProjectGroupHostId(folder)
  const existing = chatCreationFolders(state.projectGroups).find(
    (group) =>
      getNewWorkspaceProjectGroupHostId(group) === hostId &&
      isSamePath(group.parentPath ?? '', folder.parentPath ?? '')
  )
  if (existing) {
    return existing
  }
  return state.createProjectGroup(folder.name, {
    parentPath: folder.parentPath ?? undefined,
    hostId
  })
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
