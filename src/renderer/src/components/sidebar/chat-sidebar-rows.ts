import { getAgentRowConversationName } from '../../../../shared/agent-row-conversation-name'
import {
  folderWorkspaceToWorktree,
  projectGroupIdFromRepoId
} from '../../../../shared/folder-workspace-worktree'
import {
  getWorktreeExecutionHostId,
  getSettingsFocusedExecutionHostId
} from '../../../../shared/execution-host'
import {
  resolveAiVaultSessionWorktreeInfo,
  type AiVaultSessionWorktreeInfo
} from '../right-sidebar/ai-vault-session-worktree'
import {
  isAiVaultSessionResumableContent,
  type AiVaultSession
} from '../../../../shared/ai-vault-types'
import type { Worktree } from '../../../../shared/worktree/types'
import {
  chatFallbackId,
  chatSessionKey,
  chatSessionTime,
  type ChatSidebarRow,
  type ChatSidebarState
} from './chat-sidebar-types'
import { buildAgentChatRows } from './chat-sidebar-agent-rows'
import { chatPreference, isChatCompleted } from './chat-sidebar-identity'
import { chatWorkspaceNameOwners, manualWorkspaceName } from './chat-sidebar-workspace-names'
import { chatLiveSession, chatSnapshotSessions } from './chat-sidebar-session-snapshot'

export function chatSidebarWorktrees(
  state: Pick<ChatSidebarState, 'worktreesByRepo' | 'folderWorkspaces'>
): Worktree[] {
  return [
    ...new Map(
      [
        ...Object.values(state.worktreesByRepo).flat(),
        ...state.folderWorkspaces.map(folderWorkspaceToWorktree)
      ].map((worktree) => [worktree.id, worktree])
    ).values()
  ]
}

export function chatFolderLabel(state: ChatSidebarState, worktree: Worktree): string {
  const repo = state.repos.find((item) => item.id === worktree.repoId)
  const groupId = repo?.projectGroupId ?? projectGroupIdFromRepoId(worktree.repoId)
  return (
    state.projectGroups.find((group) => group.id === groupId)?.name ??
    repo?.displayName ??
    worktree.path.split(/[\\/]/).findLast(Boolean) ??
    'Folder'
  )
}

/** Resident tabs beat historical copies; then a working copy; then the newest. */
function outranks(row: ChatSidebarRow, previous: ChatSidebarRow): boolean {
  return (
    (Number(Boolean(row.tabId)) - Number(Boolean(previous.tabId)) ||
      Number(row.state === 'working') - Number(previous.state === 'working') ||
      row.timestamp - previous.timestamp) > 0
  )
}

export function buildChatSidebarRows(
  state: ChatSidebarState,
  sessions: readonly AiVaultSession[],
  now: number,
  /** Session id to its resolved workspace; computed per session when omitted. */
  sessionWorktrees?: ReadonlyMap<string, AiVaultSessionWorktreeInfo>
): ChatSidebarRow[] {
  const rows = new Map<string, ChatSidebarRow>()
  const worktrees = chatSidebarWorktrees(state)
  const repoById = new Map(state.repos.map((repo) => [repo.id, repo]))
  const focusedHostId = getSettingsFocusedExecutionHostId(state.settings)
  const hostOf = (worktree: Worktree) =>
    getWorktreeExecutionHostId(worktree, repoById.get(worktree.repoId), focusedHostId)
  const settings = state.settings?.chatSidebar
  const sessionMap = new Map(
    sessions.map((session) => [
      chatSessionKey(session.executionHostId, session.agent, session.sessionId),
      session
    ])
  )
  // Why: a slow or failing scan must not hide chats that were already registered.
  const remembered = chatSnapshotSessions(settings?.sessions, new Set(sessionMap.keys()))
  for (const session of remembered) {
    sessionMap.set(
      chatSessionKey(session.executionHostId, session.agent, session.sessionId),
      session
    )
  }
  const rememberedSessions = new Set(remembered)
  const hidden = new Set(settings?.hidden ?? [])
  const generatedTitles = state.settings?.tabAutoGenerateTitle === true
  const sleepingByTabId = new Map(
    Object.values(state.sleepingAgentSessionsByPaneKey).flatMap((record) =>
      record.tabId ? [[`${record.worktreeId}\n${record.tabId}`, record] as const] : []
    )
  )
  const add = (row: ChatSidebarRow) => {
    if ([row.id, ...row.aliases].some((id) => hidden.has(id))) {
      return
    }
    row.completed = isChatCompleted(row, chatPreference(settings?.completed, row))
    const previous = rows.get(row.id)
    if (!previous || outranks(row, previous)) {
      rows.set(row.id, row)
    }
  }
  for (const worktree of worktrees) {
    const hostId = hostOf(worktree)
    const folder = chatFolderLabel(state, worktree)
    const live = buildAgentChatRows({ state, worktree, hostId, folder, sessions: sessionMap, now })
    live.rows.forEach(add)
    for (const tab of state.tabsByWorktree[worktree.id] ?? []) {
      const sleeping = sleepingByTabId.get(`${worktree.id}\n${tab.id}`)
      if (
        live.representedTabIds.has(tab.id) ||
        (!tab.launchAgent && !tab.aiVaultTitle && !sleeping)
      ) {
        continue
      }
      const agent = tab.aiVaultTitle?.agent ?? sleeping?.agent ?? tab.launchAgent ?? 'unknown'
      const sessionId = tab.aiVaultTitle?.sessionId ?? sleeping?.providerSession.id
      const key = sessionId ? chatSessionKey(hostId, agent, sessionId) : null
      const session = key ? (sessionMap.get(key) ?? null) : null
      const fallbackIds = [
        chatFallbackId(hostId, tab.id),
        ...(sleeping ? [chatFallbackId(hostId, sleeping.paneKey)] : [])
      ]
      const sessionAt = session ? chatSessionTime(session) : tab.createdAt
      const title =
        getAgentRowConversationName(tab, agent, generatedTitles, undefined, sessionId) ??
        session?.title ??
        tab.title
      add({
        id: key ?? fallbackIds[0],
        aliases: key ? fallbackIds : fallbackIds.slice(1),
        sessionKey: key,
        title,
        manualTitle: tab.customTitle?.trim() || null,
        folder,
        worktree,
        hostId,
        tabId: tab.id,
        paneKey: sleeping?.paneKey ?? null,
        session,
        timestamp: sleeping?.updatedAt ?? sessionAt,
        turnStartedAt: sessionAt,
        activityFromState: false,
        state: 'idle',
        completed: false,
        ownsWorkspaceName: false,
        liveSession: sleeping
          ? chatLiveSession(sleeping.agent, sleeping.providerSession, title)
          : null
      })
    }
    for (const tab of state.unifiedTabsByWorktree[worktree.id] ?? []) {
      if (tab.contentType !== 'agent-session' || live.representedTabIds.has(tab.id)) {
        continue
      }
      const key = chatSessionKey(hostId, tab.agentSessionAgent ?? 'unknown', tab.entityId)
      const session = sessionMap.get(key) ?? null
      const sessionAt = session ? chatSessionTime(session) : tab.createdAt
      add({
        id: key,
        aliases: [chatFallbackId(hostId, tab.id)],
        sessionKey: key,
        title: tab.customLabel ?? tab.aiVaultTitle?.title ?? tab.generatedLabel ?? tab.label,
        manualTitle: tab.customLabel?.trim() || null,
        folder,
        worktree,
        hostId,
        tabId: tab.id,
        paneKey: null,
        session,
        timestamp: sessionAt,
        turnStartedAt: sessionAt,
        activityFromState: false,
        state: 'idle',
        completed: false,
        ownsWorkspaceName: false,
        liveSession: null
      })
    }
  }
  const worktreeById = new Map(worktrees.map((worktree) => [worktree.id, worktree]))
  const claimed = new Set([...rows.values()].flatMap((row) => [row.id, ...row.aliases]))
  for (const session of [...sessions, ...remembered]) {
    if (
      session.subagent ||
      (!rememberedSessions.has(session) && !isAiVaultSessionResumableContent(session))
    ) {
      continue
    }
    const key = chatSessionKey(session.executionHostId, session.agent, session.sessionId)
    if (claimed.has(key) || hidden.has(key)) {
      continue
    }
    const tracked = settings?.sessions?.[key]
    const imported =
      settings?.historySince !== undefined &&
      Date.parse(session.createdAt ?? session.modifiedAt) >= settings.historySince
    if (!tracked && !imported) {
      continue
    }
    const worktreeId =
      tracked?.worktreeId ??
      (sessionWorktrees
        ? sessionWorktrees.get(session.id)
        : resolveAiVaultSessionWorktreeInfo({
            session,
            worktrees,
            repos: state.repos,
            activeWorktreeId: null
          })
      )?.worktreeId
    const worktree = worktreeId ? worktreeById.get(worktreeId) : undefined
    // Why: archived workspaces cannot resume, and a chat must stay on the host that ran it.
    if (!worktree || worktree.isArchived || hostOf(worktree) !== session.executionHostId) {
      continue
    }
    const sessionAt = chatSessionTime(session)
    add({
      id: key,
      aliases: [],
      sessionKey: key,
      title: session.title,
      manualTitle: null,
      folder: chatFolderLabel(state, worktree),
      worktree,
      hostId: session.executionHostId,
      tabId: null,
      paneKey: null,
      session,
      timestamp: sessionAt,
      turnStartedAt: sessionAt,
      activityFromState: false,
      state: 'idle',
      completed: false,
      ownsWorkspaceName: false,
      liveSession: null
    })
  }
  const result = [...rows.values()]
  const owners = chatWorkspaceNameOwners(state, result)
  for (const row of result) {
    row.ownsWorkspaceName = owners.get(row.worktree.id) === row
    const workspaceName = row.ownsWorkspaceName ? manualWorkspaceName(state, row.worktree) : null
    row.title =
      chatPreference(settings?.titles, row) ?? row.manualTitle ?? workspaceName ?? row.title
  }
  return result.sort(compareChatSidebarRows)
}

export function compareChatSidebarRows(a: ChatSidebarRow, b: ChatSidebarRow): number {
  return (
    Number(b.state === 'working') - Number(a.state === 'working') ||
    b.timestamp - a.timestamp ||
    a.id.localeCompare(b.id)
  )
}
