import type { TerminalTab } from '../../../shared/terminal-tab-types'

type TabsByWorktree = Record<string, TerminalTab[]>

type AgentStatusTabIndex = {
  byId: Map<string, { tab: TerminalTab; owningWorktreeId: string }>
  byWorktree: Map<string, Map<string, TerminalTab>>
  tabVisits: number
}

const indexes = new WeakMap<TabsByWorktree, AgentStatusTabIndex>()

// Immutable tab maps let routing and recovery share one first-match ownership scan.
export function getAgentStatusTabIndex(tabsByWorktree: TabsByWorktree): AgentStatusTabIndex {
  const cached = indexes.get(tabsByWorktree)
  if (cached) {
    return cached
  }
  const index: AgentStatusTabIndex = {
    byId: new Map(),
    byWorktree: new Map(),
    tabVisits: 0
  }
  for (const [worktreeId, tabs] of Object.entries(tabsByWorktree)) {
    const bucket = new Map<string, TerminalTab>()
    index.byWorktree.set(worktreeId, bucket)
    for (const tab of tabs) {
      const tabId = tab.id
      index.tabVisits += 1
      if (!bucket.has(tabId)) {
        bucket.set(tabId, tab)
      }
      if (!index.byId.has(tabId)) {
        index.byId.set(tabId, { tab, owningWorktreeId: worktreeId })
      }
    }
  }
  indexes.set(tabsByWorktree, index)
  return index
}
