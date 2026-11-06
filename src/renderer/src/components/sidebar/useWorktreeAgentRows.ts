import { getStructuredAgentSessionTabsByPaneKey } from '@/components/native-chat/structured-agent-session-tabs'
import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { DashboardAgentRow } from '@/components/dashboard/useDashboardData'
import { applyAgentRowLineage } from '@/components/dashboard/agent-row-lineage'
import { migrationUnsupportedToAgentStatusEntry } from '../../../../shared/migration-unsupported-agent-entry'
import { useAppStore } from '@/store'
import {
  EMPTY_FOREGROUND_AGENTS,
  EMPTY_LIVE_PTY_IDS,
  EMPTY_PANE_FOREGROUND_AGENTS,
  EMPTY_RUNTIME_PANE_TITLES,
  selectForegroundAgentsForWorktree,
  selectLivePtyIdsForWorktree,
  selectPaneForegroundAgentsForWorktree,
  selectRuntimePaneTitlesForWorktree
} from './worktree-card-status-inputs'
import { buildWorktreeAgentRows } from './worktree-agent-rows'
import {
  EMPTY_LIVE_ENTRIES,
  EMPTY_MIGRATION_UNSUPPORTED_ENTRIES,
  EMPTY_RETAINED,
  EMPTY_TERMINAL_LAYOUTS,
  selectLiveAgentStatusEntriesForWorktree,
  selectMigrationUnsupportedEntriesForWorktree,
  selectRuntimeAgentOrchestrationForWorktree,
  selectRetainedAgentEntriesForWorktree,
  selectTerminalLayoutsForWorktree
} from './worktree-agent-row-selectors'
import { EMPTY_WORKTREE_AGENT_ORCHESTRATION } from './worktree-agent-orchestration-index'
import { EMPTY_TABS } from './WorktreeCardHelpers'
import {
  createWorktreeAgentFreshnessSelector,
  EMPTY_WORKTREE_AGENT_FRESHNESS_SIGNATURE
} from './worktree-agent-freshness-selector'

// Why frozen: shared by every inactive card, and callers only read these rows.
const EMPTY_AGENT_ROWS = Object.freeze([]) as unknown as DashboardAgentRow[]

export { buildWorktreeAgentRows } from './worktree-agent-rows'
export {
  selectLiveAgentStatusEntriesForWorktree,
  selectMigrationUnsupportedEntriesForWorktree,
  selectRuntimeAgentOrchestrationForWorktree,
  selectRetainedAgentEntriesForWorktree
} from './worktree-agent-row-selectors'

/** Share indexed worktree inputs across cards; derive live/retained row freshness from the available evidence. */
export function useWorktreeAgentRows(worktreeId: string, active = true): DashboardAgentRow[] {
  const selectAgentFreshness = useMemo(
    () => createWorktreeAgentFreshnessSelector(worktreeId),
    [worktreeId]
  )
  const tabs = useAppStore((s) => (active ? s.tabsByWorktree[worktreeId] : EMPTY_TABS))
  // Why: narrow the subscriptions to only THIS worktree's entries via
  // useShallow. Subscribing to the whole agentStatusByPaneKey map would make
  // every on-screen card re-render on any agent-status update anywhere —
  // O(worktrees²) render amplification. Pre-filtering here means the card
  // only re-renders when something relevant to THIS worktree changes.
  const liveEntries = useAppStore(
    useShallow((s) =>
      active ? selectLiveAgentStatusEntriesForWorktree(s, worktreeId) : EMPTY_LIVE_ENTRIES
    )
  )
  // Why: keep the store selector limited to stable raw records. Converting
  // migration entries creates fresh objects with Date.now(), which breaks
  // useSyncExternalStore's cached-snapshot contract and can blank Electron.
  const migrationUnsupported = useAppStore(
    useShallow((s) =>
      active
        ? selectMigrationUnsupportedEntriesForWorktree(s, worktreeId)
        : EMPTY_MIGRATION_UNSUPPORTED_ENTRIES
    )
  )
  const retained = useAppStore(
    useShallow((s) =>
      active ? selectRetainedAgentEntriesForWorktree(s, worktreeId) : EMPTY_RETAINED
    )
  )
  const runtimePaneTitlesByTabId = useAppStore(
    useShallow((s) =>
      active ? selectRuntimePaneTitlesForWorktree(s, worktreeId) : EMPTY_RUNTIME_PANE_TITLES
    )
  )
  const ptyIdsByTabId = useAppStore(
    useShallow((s) => (active ? selectLivePtyIdsForWorktree(s, worktreeId) : EMPTY_LIVE_PTY_IDS))
  )
  const foregroundAgentsByPaneKey = useAppStore(
    useShallow((s) =>
      active ? selectForegroundAgentsForWorktree(s, worktreeId) : EMPTY_FOREGROUND_AGENTS
    )
  )
  const terminalLayoutsByTabId = useAppStore(
    useShallow((s) =>
      active ? selectTerminalLayoutsForWorktree(s, worktreeId) : EMPTY_TERMINAL_LAYOUTS
    )
  )
  const runtimeAgentOrchestrationByPaneKey = useAppStore(
    useShallow((s) =>
      active
        ? selectRuntimeAgentOrchestrationForWorktree(s, worktreeId)
        : EMPTY_WORKTREE_AGENT_ORCHESTRATION
    )
  )
  const paneForegroundAgentByPaneKey = useAppStore(
    useShallow((s) =>
      active ? selectPaneForegroundAgentsForWorktree(s, worktreeId) : EMPTY_PANE_FOREGROUND_AGENTS
    )
  )
  const agentFreshnessSignature = useAppStore((s) =>
    active ? selectAgentFreshness(s) : EMPTY_WORKTREE_AGENT_FRESHNESS_SIGNATURE
  )

  return useMemo<DashboardAgentRow[]>(() => {
    if (!active) {
      return EMPTY_AGENT_ROWS
    }
    // Read time inside the freshness-keyed memo so rows expire without new PTY data.
    const now = Date.now()
    const entries =
      migrationUnsupported.length > 0
        ? [
            ...liveEntries,
            ...migrationUnsupported.flatMap((unsupported) => {
              const entry = migrationUnsupportedToAgentStatusEntry(unsupported)
              return entry ? [entry] : []
            })
          ]
        : liveEntries
    return applyAgentRowLineage(
      buildWorktreeAgentRows({
        tabs: tabs ?? EMPTY_TABS,
        representedTabs: getStructuredAgentSessionTabsByPaneKey(
          useAppStore.getState().unifiedTabsByWorktree
        ),
        entries,
        retained,
        runtimePaneTitlesByTabId,
        ptyIdsByTabId,
        foregroundAgentsByPaneKey,
        terminalLayoutsByTabId,
        runtimeAgentOrchestrationByPaneKey,
        paneForegroundAgentByPaneKey,
        now
      })
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    active,
    tabs,
    liveEntries,
    migrationUnsupported,
    retained,
    runtimePaneTitlesByTabId,
    ptyIdsByTabId,
    foregroundAgentsByPaneKey,
    terminalLayoutsByTabId,
    runtimeAgentOrchestrationByPaneKey,
    paneForegroundAgentByPaneKey,
    agentFreshnessSignature
  ])
}
