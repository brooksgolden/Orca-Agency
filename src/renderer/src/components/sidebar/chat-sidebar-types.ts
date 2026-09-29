import type { AgentDotState } from '@/components/AgentStateDot'
import type { AiVaultSession } from '../../../../shared/ai-vault-types'
import type { Worktree } from '../../../../shared/worktree/types'
import type { AppState } from '@/store/types'
import type { ExecutionHostId } from '../../../../shared/execution-host'
import type { AiVaultSessionTitle } from '../../../../shared/ai-vault-session-title'

export type ChatSidebarRow = {
  id: string
  /** Ids this chat was stored under before its provider session was known. */
  aliases: string[]
  title: string
  /** A name the user gave the tab itself; outranks workspace and generated names. */
  manualTitle: string | null
  folder: string
  folderWorktree?: Worktree
  worktree: Worktree
  hostId: ExecutionHostId
  tabId: string | null
  paneKey: string | null
  session: AiVaultSession | null
  timestamp: number
  createdAt?: number
  turnStartedAt: number
  /** No turn clock exists (title-derived); only a later working state proves a new turn. */
  activityFromState: boolean
  state: AgentDotState
  completed: boolean
  /** Shows its workspace's manual name; persisted so the name stays put when siblings appear. */
  ownsWorkspaceName: boolean
  sessionKey: string | null
  /** Hook-reported provider session, enough to keep a Claude or Codex chat after its tab closes. */
  liveSession: ChatLiveSession | null
  automated?: boolean
}

export type ChatLiveSession = {
  agent: AiVaultSessionTitle['agent']
  sessionId: string
  transcriptPath: string
  title: string
}

export type ChatSidebarState = Pick<
  AppState,
  | 'settings'
  | 'repos'
  | 'projectGroups'
  | 'folderWorkspaces'
  | 'worktreesByRepo'
  | 'tabsByWorktree'
  | 'unifiedTabsByWorktree'
  | 'terminalLayoutsByTabId'
  | 'runtimePaneTitlesByTabId'
  | 'ptyIdsByTabId'
  | 'paneForegroundAgentByPaneKey'
  | 'agentStatusByPaneKey'
  | 'retainedAgentsByPaneKey'
  | 'runtimeAgentOrchestrationByPaneKey'
  | 'migrationUnsupportedByPtyId'
  | 'sleepingAgentSessionsByPaneKey'
>

export function chatSessionKey(hostId: string, agent: string, sessionId: string): string {
  return JSON.stringify([hostId, agent, sessionId])
}

/** Identity for a chat whose provider session is not known yet. */
export function chatFallbackId(hostId: string, tabOrPaneKey: string): string {
  return JSON.stringify([hostId, tabOrPaneKey])
}

export function chatSessionTime(session: AiVaultSession): number {
  const timestamp = Date.parse(session.updatedAt ?? session.modifiedAt)
  return Number.isFinite(timestamp) ? timestamp : 0
}
