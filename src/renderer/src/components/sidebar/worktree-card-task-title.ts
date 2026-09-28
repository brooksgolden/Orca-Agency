import type { DashboardAgentRow } from '@/components/dashboard/useDashboardData'
import { getAgentRowPrimaryText } from '@/lib/agent-row-primary-text'
import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import {
  getAgentRowConversationName,
  type ConversationNameTab
} from '../../../../shared/agent-row-conversation-name'

export type WorkspaceAgentTitleRow = Pick<
  DashboardAgentRow,
  'agentType' | 'rowSource' | 'startedAt'
> & {
  tab: ConversationNameTab
  entry: Pick<AgentStatusEntry, 'prompt' | 'updatedAt' | 'stateStartedAt'> &
    Partial<Pick<AgentStatusEntry, 'orchestration' | 'providerSession'>>
}

/** The newest named LLM conversation in a workspace, ignoring child agents. */
export function getLatestWorkspaceAgentTitle(
  agents: readonly WorkspaceAgentTitleRow[],
  generatedTitlesEnabled: boolean
): string | null {
  let title: string | null = null
  let latestAt = Number.NEGATIVE_INFINITY
  for (const agent of agents) {
    if (agent.rowSource === 'subagent') {
      continue
    }
    const candidate =
      getAgentRowConversationName(
        agent.tab,
        agent.agentType,
        generatedTitlesEnabled,
        undefined,
        agent.entry.providerSession?.id
      ) ?? getAgentRowPrimaryText(agent.entry).split(/\r?\n/, 1)[0]?.trim()
    if (!candidate) {
      continue
    }
    const timestamp = Math.max(agent.entry.updatedAt, agent.entry.stateStartedAt, agent.startedAt)
    if (timestamp > latestAt) {
      title = candidate
      latestAt = timestamp
    }
  }
  return title
}
