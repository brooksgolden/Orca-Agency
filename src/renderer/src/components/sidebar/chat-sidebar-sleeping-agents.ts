import type { DashboardAgentRow } from '../dashboard/useDashboardData'
import { collectLeafIdsInOrder } from '../terminal-pane/terminal-layout-leaf-ids'
import { parsePaneKey } from '../../../../shared/stable-pane-id'
import type { ChatSidebarState } from './chat-sidebar-types'

/** Saved pane identities describe open chats even before their terminals reconnect. */
export function withSleepingChatAgents(
  agents: DashboardAgentRow[],
  state: ChatSidebarState,
  worktreeId: string
): DashboardAgentRow[] {
  const tabs = new Map((state.tabsByWorktree[worktreeId] ?? []).map((tab) => [tab.id, tab]))
  const saved: DashboardAgentRow[] = []
  for (const record of Object.values(state.sleepingAgentSessionsByPaneKey)) {
    if (record.worktreeId !== worktreeId) {
      continue
    }
    const pane = parsePaneKey(record.paneKey)
    const tab = pane ? tabs.get(pane.tabId) : undefined
    if (!pane || !tab || (record.tabId && record.tabId !== tab.id)) {
      continue
    }
    const layout = state.terminalLayoutsByTabId[tab.id]
    if (layout?.root && !collectLeafIdsInOrder(layout.root).includes(pane.leafId)) {
      continue
    }
    const current = agents.find((row) => row.paneKey === record.paneKey)
    if (current && current.startedAt !== 0) {
      continue
    }
    saved.push({
      tab,
      paneKey: record.paneKey,
      agentType: record.agent,
      rowSource: 'retained',
      state: current?.state ?? 'idle',
      startedAt: 0,
      entry: {
        paneKey: record.paneKey,
        tabId: tab.id,
        worktreeId,
        agentType: record.agent,
        providerSession: record.providerSession,
        prompt: record.prompt,
        state: 'done',
        sessionBoundary: true,
        stateStartedAt: record.updatedAt,
        updatedAt: record.updatedAt,
        stateHistory: []
      }
    })
  }
  const savedPanes = new Set(saved.map((row) => row.paneKey))
  return [...agents.filter((row) => row.startedAt !== 0 || !savedPanes.has(row.paneKey)), ...saved]
}
