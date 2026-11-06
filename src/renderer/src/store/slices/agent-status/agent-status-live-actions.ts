import { resolvePaneKey } from '../../../lib/agent-status-pane-ownership'
import { getRepoExecutionHostId } from '../../../../../shared/execution-host'
import { parseWorkspaceKey } from '../../../../../shared/workspace-scope'
import { isWebTerminalSurfaceTabId } from '../../../../../shared/terminal-surface-id'
import type { AgentStatusSlice } from './agent-status-slice-contract'
import type { AgentStatusRuntime } from './agent-status-runtime'
import type {
  AgentStatusMetadata,
  AgentStatusPayload,
  AgentStatusRouting,
  AgentStatusTiming
} from './agent-status-contract'
import {
  resolveAgentPaneAuthorityKey,
  transferAgentPaneAuthorityAlias
} from '../agent-pane-authority'
import {
  buildAgentStatusLiveEntry,
  type AgentStatusLiveEntryBuild,
  type AgentStatusLiveEntryRejection
} from './agent-status-live-entry-builder'
import { reduceAgentStatusLiveUpdate } from './agent-status-live-reducer'
import type { FreshnessLiveEntryDelta } from './agent-status-freshness-scheduler'
import {
  agentStatusTabAlreadyHasProtectedOrGeneratedTitle,
  findAgentPaneWorktreeId,
  getTabIdFromPaneKey,
  isRecentlyClosedAgentStatusTab
} from './agent-status-pane-key-tab-binding'
import {
  generatedTitleReplacesExisting,
  generatedTitleSourceText
} from '../../../../../shared/agent-generated-tab-title-rules'

export function createAgentStatusLiveActions(
  runtime: AgentStatusRuntime
): Pick<AgentStatusSlice, 'setAgentStatus' | 'setAgentStatuses' | 'transactAgentStatuses'> {
  const {
    projectConversation,
    get,
    set,
    applyGeneratedTabTitleUpdate,
    freshness,
    requestFreshness,
    transactAgentStatuses
  } = runtime
  const setAgentStatus = (
    rawPaneKey: string,
    payload: AgentStatusPayload,
    terminalTitle?: string,
    timing?: AgentStatusTiming,
    routing?: AgentStatusRouting,
    metadata?: AgentStatusMetadata
  ): void => {
    const paneKey = resolveAgentPaneAuthorityKey(rawPaneKey)
    if (metadata?.authorityRestartId && paneKey !== rawPaneKey) {
      return
    }
    const updatedAt = timing?.updatedAt ?? Date.now()
    const current = get()
    if (
      (paneKey in current.recentlyRetiredAgentStatusPaneKeys &&
        (typeof current.recentlyRetiredAgentStatusPaneKeys[paneKey] !== 'string' ||
          current.recentlyRetiredAgentStatusPaneKeys[paneKey] !== metadata?.authorityRestartId)) ||
      isRecentlyClosedAgentStatusTab(
        current.recentlyClosedAgentStatusTabIds,
        getTabIdFromPaneKey(paneKey)
      )
    ) {
      return
    }
    let built: AgentStatusLiveEntryBuild | AgentStatusLiveEntryRejection | null = null
    let liveEntryDelta: FreshnessLiveEntryDelta | null = null
    set((state, changedPaneKeys) => {
      const retirement = state.recentlyRetiredAgentStatusPaneKeys[paneKey]
      if (
        (retirement !== undefined &&
          (typeof retirement !== 'string' || retirement !== metadata?.authorityRestartId)) ||
        isRecentlyClosedAgentStatusTab(
          state.recentlyClosedAgentStatusTabIds,
          getTabIdFromPaneKey(paneKey)
        )
      ) {
        return state
      }
      if (retirement !== undefined) {
        const owner = resolvePaneKey(state, paneKey)
        if (
          !owner.exists ||
          payload.agentType !== 'omp' ||
          (routing?.worktreeId !== undefined && routing.worktreeId !== owner.owningWorktreeId) ||
          (routing?.connectionId !== undefined &&
            routing.connectionId !== owner.repoConnectionId &&
            (owner.repoConnectionResolved || routing.worktreeId !== owner.owningWorktreeId))
        ) {
          return state
        }
      }
      built = buildAgentStatusLiveEntry({
        state,
        paneKey,
        payload,
        terminalTitle,
        timing,
        routing,
        metadata,
        updatedAt
      })
      if (!built.entry) {
        return state
      }
      const previousEntries = state.agentStatusByPaneKey
      const reduction = reduceAgentStatusLiveUpdate(state, built, updatedAt, projectConversation)
      changedPaneKeys.add(built.entry.paneKey)
      for (const evicted of reduction.evictedEntries) {
        changedPaneKeys.add(evicted.paneKey)
      }
      liveEntryDelta = {
        previousEntries,
        nextEntries: reduction.patch.agentStatusByPaneKey ?? previousEntries,
        nextEntry: built.entry,
        replacedEntry: previousEntries[built.entry.paneKey],
        evictedEntries: reduction.evictedEntries
      }
      if (retirement !== undefined) {
        // The host confirmed this retired group’s surviving owner; preserve that route for its next retirement.
        for (const [key, id] of Object.entries(state.recentlyRetiredAgentStatusPaneKeys)) {
          if (id === retirement && key !== paneKey && resolveAgentPaneAuthorityKey(key) === key) {
            transferAgentPaneAuthorityAlias({ fromPaneKey: key, toPaneKey: paneKey })
          }
        }
        const nextRetired = { ...state.recentlyRetiredAgentStatusPaneKeys }
        delete nextRetired[paneKey]
        return { ...reduction.patch, recentlyRetiredAgentStatusPaneKeys: nextRetired }
      }
      return reduction.patch
    })
    if (liveEntryDelta) {
      freshness.noteLiveEntryDelta(liveEntryDelta)
    }
    // Zustand's updater runs synchronously, but TypeScript cannot observe the closure assignment.
    const builtResult = built as AgentStatusLiveEntryBuild | AgentStatusLiveEntryRejection | null
    if (!builtResult?.entry) {
      // Rejected stale standalone events retain deferred scan contract; suppressed inherited-terminal frames must skip O(entries) work.
      if (builtResult?.reason !== 'suppressed-inherited-terminal') {
        requestFreshness(false)
      }
      return
    }
    const { entry } = builtResult
    const observationAt = entry.evidenceObservedAt ?? entry.updatedAt
    const startedNewWork =
      entry.state === 'working' &&
      (builtResult.existing?.state !== 'working' || builtResult.commandCodeNewTurn) &&
      entry.restoredUnconfirmed !== true &&
      Math.abs(Date.now() - observationAt) < 60_000
    if (startedNewWork) {
      const worktreeId =
        entry.connectionId || isWebTerminalSurfaceTabId(getTabIdFromPaneKey(paneKey) ?? '')
          ? (entry.worktreeId ?? findAgentPaneWorktreeId(get(), paneKey))
          : (findAgentPaneWorktreeId(get(), paneKey) ?? entry.worktreeId)
      const current = get()
      let worktree =
        worktreeId && parseWorkspaceKey(worktreeId)?.type === 'folder'
          ? current.getKnownWorktreeById(worktreeId)
          : undefined
      let executionHostId = worktree?.hostId
      if (worktreeId && !worktree) {
        let ambiguousOwner = false
        for (const repo of current.repos) {
          if (
            entry.connectionId !== undefined &&
            (repo.connectionId ?? null) !== entry.connectionId
          ) {
            continue
          }
          const hostId = getRepoExecutionHostId(repo)
          const candidate = current.getKnownWorktreeById(worktreeId, hostId)
          if (candidate?.repoId !== repo.id) {
            continue
          }
          if (worktree && executionHostId !== hostId) {
            ambiguousOwner = true
            break
          }
          worktree = candidate
          executionHostId = hostId
        }
        if (ambiguousOwner) {
          worktree = undefined
        }
      }
      if (worktree) {
        const completed = worktree.workspaceStatus === 'completed'
        const canReopen = current.workspaceStatuses.some((status) => status.id === 'in-progress')
        // A real new turn is activity even in the selected workspace, whose PTY output
        // deliberately does not trigger a sidebar reorder just from being clicked.
        void current.updateWorktreeMeta(
          worktree.id,
          {
            lastActivityAt: Date.now(),
            ...(completed && canReopen ? { workspaceStatus: 'in-progress' } : {})
          },
          { executionHostId: executionHostId ?? 'local' }
        )
      }
    }
    // Sticky orchestration titles are replaced only when they still describe this dispatch.
    const shouldReplaceGeneratedTitle = generatedTitleReplacesExisting(entry)
    const mayWriteGeneratedTitle =
      get().settings?.tabAutoGenerateTitle === true &&
      (shouldReplaceGeneratedTitle ||
        !agentStatusTabAlreadyHasProtectedOrGeneratedTitle(
          get(),
          entry.tabId ?? getTabIdFromPaneKey(paneKey),
          entry.worktreeId
        ))
    const generatedTitlePrompt = mayWriteGeneratedTitle
      ? generatedTitleSourceText(entry)
      : entry.prompt
    applyGeneratedTabTitleUpdate({
      paneKey,
      prompt: generatedTitlePrompt,
      ...(shouldReplaceGeneratedTitle ? { options: { replaceExistingGeneratedTitle: true } } : {})
    })
    requestFreshness(true)
    if (builtResult.completionRefreshWorktreeId) {
      const worktreeId = builtResult.completionRefreshWorktreeId
      queueMicrotask(() => get().refreshGitHubForWorktreeIfStale(worktreeId))
    }
  }

  const setAgentStatuses = (updates: Parameters<AgentStatusSlice['setAgentStatuses']>[0]) =>
    updates.length === 0
      ? []
      : transactAgentStatuses((transaction) => updates.map(transaction.apply))

  return { setAgentStatus, setAgentStatuses, transactAgentStatuses }
}
