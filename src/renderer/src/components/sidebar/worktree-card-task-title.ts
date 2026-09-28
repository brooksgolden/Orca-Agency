import { rowConversationName } from '@/components/dashboard/dashboard-card-labels'
import type { DashboardAgentRow } from '@/components/dashboard/useDashboardData'
import { getAgentRowPrimaryText } from '@/lib/agent-row-primary-text'
import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import type { ConversationNameTab } from '../../../../shared/agent-row-conversation-name'
import type { TerminalLayoutSnapshot } from '../../../../shared/terminal-tab-types'

export type WorkspaceAgentTitleRow = Pick<
  DashboardAgentRow,
  'agentType' | 'rowSource' | 'startedAt' | 'paneKey' | 'lineage'
> & {
  tab: ConversationNameTab & { id: string }
  entry: Pick<AgentStatusEntry, 'prompt' | 'updatedAt' | 'stateStartedAt'> &
    Partial<Pick<AgentStatusEntry, 'orchestration' | 'providerSession'>>
}

/** The newest named LLM conversation in a workspace, ignoring child agents. */
export function getLatestWorkspaceAgentTitle(
  agents: readonly WorkspaceAgentTitleRow[],
  generatedTitlesEnabled: boolean,
  layoutsByTabId: Readonly<Record<string, TerminalLayoutSnapshot | undefined>> = {},
  paneTitlesByTabId: Readonly<Record<string, Record<number, string>>> = {}
): string | null {
  let title: string | null = null
  let latestAt = Number.NEGATIVE_INFINITY
  for (const agent of agents) {
    // Why: an orchestrated child is part of its parent's task, not a new conversation.
    if (agent.rowSource === 'subagent' || agent.lineage?.depth === 1) {
      continue
    }
    // Why: same naming as the Activity view, so a split tab names each pane's own agent.
    const candidate =
      rowConversationName(
        agent,
        generatedTitlesEnabled,
        layoutsByTabId[agent.tab.id],
        paneTitlesByTabId[agent.tab.id]
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
