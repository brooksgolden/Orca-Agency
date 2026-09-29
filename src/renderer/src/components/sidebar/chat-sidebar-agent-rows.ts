import { buildWorktreeAgentRows } from './worktree-agent-rows'
import {
  selectLiveAgentStatusEntriesForWorktree,
  selectRetainedAgentEntriesForWorktree
} from './worktree-agent-row-selectors'
import { rowConversationName } from '../dashboard/dashboard-card-labels'
import { lastEnteredDoneAt } from '../dashboard/agent-finished-timestamp'
import type { DashboardAgentRow } from '../dashboard/useDashboardData'
import { getAgentRowPrimaryText } from '@/lib/agent-row-primary-text'
import { agentStatusEvidenceObservedAt } from '../../../../shared/agent-status-freshness'
import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import type { AiVaultSession } from '../../../../shared/ai-vault-types'
import type { ExecutionHostId } from '../../../../shared/execution-host'
import type { Worktree } from '../../../../shared/worktree/types'
import {
  chatFallbackId,
  chatSessionKey,
  chatSessionTime,
  type ChatSidebarRow,
  type ChatSidebarState
} from './chat-sidebar-types'
import { chatLiveSession } from './chat-sidebar-session-snapshot'

/** When the latest working turn began; heartbeats and session-boundary snapshots never move it. */
function latestTurnStart(entry: AgentStatusEntry): number {
  let latest = entry.state === 'working' ? entry.stateStartedAt : 0
  for (const item of entry.stateHistory) {
    if (item.state === 'working' && item.startedAt > latest) {
      latest = item.startedAt
    }
  }
  return latest
}

function rowTimestamp(agent: DashboardAgentRow, sessionAt: number): number {
  if (agent.startedAt === 0) {
    // Why: title-derived rows stamp `now` on every render, which is not activity.
    return sessionAt
  }
  if (agent.state === 'done') {
    return lastEnteredDoneAt(agent) ?? agentStatusEvidenceObservedAt(agent.entry)
  }
  // Why: updatedAt moves on heartbeats and relay restamps; state start and evidence time do not.
  return agent.state === 'working'
    ? agent.entry.stateStartedAt
    : agentStatusEvidenceObservedAt(agent.entry)
}

export function buildAgentChatRows(args: {
  state: ChatSidebarState
  worktree: Worktree
  hostId: ExecutionHostId
  folder: string
  sessions: ReadonlyMap<string, AiVaultSession>
  now: number
}): { rows: ChatSidebarRow[]; representedTabIds: Set<string> } {
  const { state, worktree, hostId } = args
  const tabs = state.tabsByWorktree[worktree.id] ?? []
  const unifiedById = new Map(
    (state.unifiedTabsByWorktree[worktree.id] ?? []).map((tab) => [tab.id, tab])
  )
  const residentTabIds = new Set([...tabs.map((tab) => tab.id), ...unifiedById.keys()])
  const agents = buildWorktreeAgentRows({
    tabs,
    entries: selectLiveAgentStatusEntriesForWorktree(state, worktree.id),
    retained: selectRetainedAgentEntriesForWorktree(state, worktree.id),
    runtimePaneTitlesByTabId: state.runtimePaneTitlesByTabId,
    terminalLayoutsByTabId: state.terminalLayoutsByTabId,
    ptyIdsByTabId: state.ptyIdsByTabId,
    foregroundAgentsByPaneKey: state.paneForegroundAgentByPaneKey,
    runtimeAgentOrchestrationByPaneKey: state.runtimeAgentOrchestrationByPaneKey,
    now: args.now
  }).filter((agent) => agent.rowSource !== 'subagent')
  const chatPanesByTab = new Map<string, number>()
  for (const agent of agents) {
    chatPanesByTab.set(agent.tab.id, (chatPanesByTab.get(agent.tab.id) ?? 0) + 1)
  }
  const rows: ChatSidebarRow[] = []
  const representedTabIds = new Set<string>()
  for (const agent of agents) {
    const soleChat = chatPanesByTab.get(agent.tab.id) === 1
    const providerSession = agent.entry.providerSession
    // Why: the tab-level provider title belongs to one pane, so split siblings must not borrow it.
    const tabSession =
      !providerSession &&
      soleChat &&
      (agent.agentType === agent.tab.aiVaultTitle?.agent || agent.agentType === 'unknown')
        ? agent.tab.aiVaultTitle
        : undefined
    const sessionAgent = providerSession ? agent.agentType : tabSession?.agent
    const sessionId = providerSession?.id ?? tabSession?.sessionId
    const structuredTab = unifiedById.get(agent.tab.id)
    const structuredKey =
      structuredTab?.contentType === 'agent-session'
        ? chatSessionKey(
            hostId,
            structuredTab.agentSessionAgent ?? 'unknown',
            structuredTab.entityId
          )
        : null
    const sessionKey =
      sessionAgent && sessionId ? chatSessionKey(hostId, sessionAgent, sessionId) : structuredKey
    const session = sessionKey ? (args.sessions.get(sessionKey) ?? null) : null
    const resident = residentTabIds.has(agent.tab.id)
    if (!resident && !session) {
      continue
    }
    representedTabIds.add(agent.tab.id)
    const fallbackIds = [
      ...(structuredKey ? [structuredKey] : []),
      ...(soleChat ? [chatFallbackId(hostId, agent.tab.id)] : []),
      chatFallbackId(hostId, agent.paneKey)
    ]
    const id = sessionKey ?? fallbackIds[0]
    const nameSource =
      providerSession || !sessionId
        ? agent
        : {
            ...agent,
            entry: {
              orchestration: agent.entry.orchestration,
              providerSession: { key: 'session_id' as const, id: sessionId }
            }
          }
    const sessionAt = session ? chatSessionTime(session) : agent.tab.createdAt
    const title =
      rowConversationName(
        nameSource,
        state.settings?.tabAutoGenerateTitle === true,
        state.terminalLayoutsByTabId[agent.tab.id],
        state.runtimePaneTitlesByTabId[agent.tab.id]
      ) ??
      session?.title ??
      (getAgentRowPrimaryText(agent.entry).split(/\r?\n/, 1)[0]?.trim() || 'New chat')
    rows.push({
      id,
      aliases: fallbackIds.filter((alias) => alias !== id),
      sessionKey,
      title,
      manualTitle: agent.tab.customTitle?.trim() || null,
      folder: args.folder,
      worktree,
      hostId,
      tabId: resident ? agent.tab.id : null,
      paneKey: resident ? agent.paneKey : null,
      session,
      timestamp: rowTimestamp(agent, sessionAt),
      turnStartedAt: agent.startedAt === 0 ? sessionAt : latestTurnStart(agent.entry),
      activityFromState: agent.startedAt === 0,
      state: agent.state,
      completed: false,
      ownsWorkspaceName: false,
      liveSession: chatLiveSession(agent.agentType, providerSession, title)
    })
  }
  return { rows, representedTabIds }
}
