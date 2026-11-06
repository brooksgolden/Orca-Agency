/* eslint-disable max-lines -- Why: Inventory refresh combines controller listing, worktree matching, and guarded PTY state reconciliation. */
import { OrcaRuntimeWithPtyControllerInventoryListing } from './pty-controller-inventory-listing'
import type { ResolvedWorktree } from '../../runtime-worktree-path-identity'
import type * as PtyControllerContract from '../../runtime-pty-controller-contract'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../../shared/constants'
import {
  type ExecutionHostId,
  getConnectionExecutionHostId,
  LOCAL_EXECUTION_HOST_ID,
  parseExecutionHostId
} from '../../../../shared/execution-host'
import { getPtyExecutionHost } from '../../../../shared/terminal-execution-host'
import {
  createIncrementalResolvedWorktreeLookup,
  findResolvedWorktreeIdForPath,
  inferWorktreeIdFromPtyId
} from '../../runtime-worktree-path-identity'
import {
  indexPersistedPtySurfaceBindings,
  indexPersistedPtyWorktreeBindings,
  type PersistedPtyBindingIndexes
} from '../../runtime-worktree-binding-index'
import { parseAppSshPtyId } from '../../../../shared/ssh-pty-id'
import { indexFloatingSnapshotPtyBindings } from '../../floating-snapshot-pty-bindings'
import { NO_OBSERVING_PROVIDER_REASON } from '../../../../shared/pty-liveness-verdict'
import { buildControllerTerminalIdentities } from '../../orca-runtime-build-controller-terminal-identities'
import { retireOrchestrationAuthorityAbsentFromInventory } from '../../runtime-restored-orchestration-authority-sweep'
import { worktreeIdsEqual } from '../../../../shared/worktree/id'
import { ORCA_LAYOUT_OWNER_IS_MAIN } from '../../../../shared/layout-owner-switch'
import { exitingPtyIdsOf } from '../adoption/unshown-live-terminal-placement'
import { resolveAgentStatusBinding } from '../../../ipc/agent-status-ipc-boundary'
import { pruneOldestMapEntry } from '../../prune-oldest-map-entry'

export abstract class OrcaRuntimeWithRefreshPtyWorktreeRecordsWithControllerInventory extends OrcaRuntimeWithPtyControllerInventoryListing {
  private readonly restoredWorkingTitleMonitors = new Map<string, string>()

  /** Agency: a restored Codex working title is confirmed only after its inventory-proven local PTY is reattached. */
  protected reconcileRestoredWorkingTitleMonitor(ptyId: string, attempt = 0): void {
    const pty = this.ptysById.get(ptyId)
    if (!pty?.connected || pty.connectionId !== null || !pty.paneKey || !pty.incarnationId) {
      return
    }
    const row = (this.getAgentProviderSessionRowsForPaneFn?.(pty.paneKey) ?? []).find(
      (candidate) =>
        candidate.agentType === 'codex' &&
        candidate.state === 'working' &&
        candidate.restoredUnconfirmed === true &&
        (candidate.connectionId ?? null) === null
    )
    const receipt = this.restoredOrchestrationAuthorityByPtyId.get(ptyId)
    const binding = resolveAgentStatusBinding(pty.paneKey, this)
    if (
      !row ||
      this.graphStatus !== 'ready' ||
      binding.kind !== 'pane' ||
      receipt?.paneKey !== pty.paneKey ||
      receipt?.terminalHandle !== binding.terminalHandle ||
      receipt?.processIncarnation !== binding.processIncarnation ||
      !this.isKnownUnattachedLocalDaemonPty(ptyId) ||
      (row.terminalHandle && row.terminalHandle !== binding.terminalHandle) ||
      this.restoredWorkingTitleMonitors.get(ptyId) === binding.processIncarnation
    ) {
      return
    }
    const attachment = this.mainDaemonAttachments.ensure(ptyId)
    if (!attachment) {
      return
    }
    const incarnation = binding.processIncarnation
    this.restoredWorkingTitleMonitors.set(ptyId, incarnation)
    pruneOldestMapEntry(this.restoredWorkingTitleMonitors, 512)
    // Observe the shared stream acquisition; fresh native bytes alone confirm status.
    void attachment.then((attached) => {
      if (!attached && this.restoredWorkingTitleMonitors.get(ptyId) === incarnation) {
        this.restoredWorkingTitleMonitors.delete(ptyId)
        if (attempt < 2) {
          const retry = setTimeout(
            () => {
              if (this.getTerminalProcessIncarnation(binding.terminalHandle) === incarnation) {
                this.reconcileRestoredWorkingTitleMonitor(ptyId, attempt + 1)
              }
            },
            500 * (attempt + 1)
          )
          retry.unref()
        }
      }
    })
  }

  protected async refreshPtyWorktreeRecordsWithControllerInventory(
    resolvedWorktrees: ResolvedWorktree[],
    targetWorktreeId: string | null = null,
    deadline?: number,
    connectionId?: string | null,
    retryStale = false,
    inventoryOptions?: PtyControllerContract.PtyInventoryRefreshOptions
  ): Promise<PtyControllerContract.PtyControllerInventory | null> {
    if (targetWorktreeId === FLOATING_TERMINAL_WORKTREE_ID) {
      const targetedLiveness = this.refreshFloatingWorkspacePtyLiveness()
      if (targetedLiveness !== null) {
        return {
          livePtyIds: targetedLiveness,
          allLivePtyIds: targetedLiveness,
          terminalIdentityByPtyId: new Map(),
          queriedHostIds: new Set([LOCAL_EXECUTION_HOST_ID])
        }
      }
    }
    const livenessObservationAtStart = this.ptyLivenessObservationSequence
    const listing = await this.listPtyControllerInventory(
      targetWorktreeId !== null,
      deadline,
      connectionId,
      inventoryOptions
    )
    if (!listing) {
      return null
    }
    if (listing.stale) {
      if (targetWorktreeId !== null && !retryStale) {
        return this.refreshPtyWorktreeRecordsWithControllerInventory(
          resolvedWorktrees,
          targetWorktreeId,
          deadline,
          connectionId,
          true,
          inventoryOptions
        )
      }
      return null
    }
    const sessions = listing.processes
    const queriedHostIds = new Set<ExecutionHostId>(listing.hostIds)
    if (connectionId === undefined) {
      for (const session of sessions) {
        const hostId = getPtyExecutionHost(session.id)
        if (hostId && hostId !== 'foreign' && parseExecutionHostId(hostId)?.kind === 'ssh') {
          queriedHostIds.add(hostId)
        }
      }
    }
    const { controllerIdentityByPtyId } = buildControllerTerminalIdentities(sessions)
    const findResolvedWorktree = createIncrementalResolvedWorktreeLookup(resolvedWorktrees)
    const persistedIndexesByHostId = new Map<ExecutionHostId, PersistedPtyBindingIndexes>()
    const getPersistedIndexes = (hostId: ExecutionHostId) => {
      const existing = persistedIndexesByHostId.get(hostId)
      if (existing) {
        return existing
      }
      const persistedSession = this.store?.getWorkspaceSession?.(hostId)
      const indexes = {
        worktreeIdByPtyId: indexPersistedPtyWorktreeBindings(persistedSession),
        surfaceByPtyId: indexPersistedPtySurfaceBindings(persistedSession)
      }
      persistedIndexesByHostId.set(hostId, indexes)
      return indexes
    }
    const floatingPtyBindings = indexFloatingSnapshotPtyBindings(
      this.mobileSessionTabsByWorktree.get(FLOATING_TERMINAL_WORKTREE_ID),
      (tab) => this.getMobileTerminalPaneKey(tab)
    )
    const allLivePtyIds = new Set(sessions.map((session) => session.id))
    const selectedLivePtyIds = new Set<string>()
    for (const session of sessions) {
      // The owning inventory positively observed this PTY, providing host evidence of life.
      this.markPtyLivenessLive(session.id, livenessObservationAtStart)
      const sessionConnectionId =
        parseAppSshPtyId(session.id)?.connectionId ??
        (typeof connectionId === 'string' ? connectionId : null)
      const persistedIndexes = getPersistedIndexes(
        getConnectionExecutionHostId(sessionConnectionId)
      )
      const controllerIdentity = controllerIdentityByPtyId.get(session.id)
      const persistedWorktreeId = persistedIndexes.worktreeIdByPtyId.get(session.id)
      const providerWorktree = session.worktreeId
        ? findResolvedWorktree(session.worktreeId)
        : undefined
      const inferredWorktreeId = inferWorktreeIdFromPtyId(session.id)
      const persistedWorktree = persistedWorktreeId
        ? findResolvedWorktree(persistedWorktreeId)
        : undefined
      // Floating workspaces do not resolve as worktrees; retain their sentinel instead of re-filing by cwd (#23428).
      const recordedFloating =
        persistedWorktreeId === FLOATING_TERMINAL_WORKTREE_ID ||
        floatingPtyBindings.has(session.id) ||
        this.ptysById.get(session.id)?.worktreeId === FLOATING_TERMINAL_WORKTREE_ID
      const hasMigrationEvidence = Boolean(
        session.worktreeId &&
        !providerWorktree &&
        persistedWorktree &&
        inferredWorktreeId &&
        worktreeIdsEqual(session.worktreeId, inferredWorktreeId)
      )
      // Agency: a local terminal moved between worktrees keeps its new owner ahead of the provider and persisted owners.
      const movedWorktreeId =
        sessionConnectionId === null ? this.resolveLocalTerminalMoveWorkspace(session) : null
      // Explicit unresolved provider ownership wins unless the session id proves it predates a persisted rename.
      const worktreeId =
        movedWorktreeId ??
        (providerWorktree
          ? providerWorktree.id
          : hasMigrationEvidence
            ? (persistedWorktree?.id ?? null)
            : (session.worktreeId ??
              persistedWorktree?.id ??
              (recordedFloating ? FLOATING_TERMINAL_WORKTREE_ID : undefined) ??
              inferredWorktreeId ??
              findResolvedWorktreeIdForPath(resolvedWorktrees, session.cwd, targetWorktreeId)))
      const persistedSurface = persistedIndexes.surfaceByPtyId.get(session.id)
      const restoresExactSurface =
        persistedSurface &&
        session.incarnationId &&
        persistedSurface.incarnationId === session.incarnationId &&
        !!worktreeId &&
        worktreeIdsEqual(persistedSurface.worktreeId, worktreeId)
      this.adoptControllerTerminalHandle(
        session.id,
        controllerIdentity?.handle ?? session.terminalHandle,
        controllerIdentity?.incarnationId ?? session.incarnationId,
        { exactRestoredSurface: Boolean(restoresExactSurface && controllerIdentity) }
      )
      if (!targetWorktreeId || (worktreeId && worktreeIdsEqual(worktreeId, targetWorktreeId))) {
        selectedLivePtyIds.add(session.id)
      }
      if (targetWorktreeId && (!worktreeId || !worktreeIdsEqual(worktreeId, targetWorktreeId))) {
        const receipt = this.restoredOrchestrationAuthorityByPtyId.get(session.id)
        if (receipt && worktreeIdsEqual(receipt.worktreeId, targetWorktreeId)) {
          this.restoredOrchestrationAuthorityByPtyId.delete(session.id)
        }
        continue
      }
      this.restoredOrchestrationAuthorityByPtyId.delete(session.id)
      if (worktreeId) {
        const pty = this.recordPtyWorktree(session.id, worktreeId, {
          connected: true,
          ...(session.incarnationId ? { incarnationId: session.incarnationId } : {}),
          agentSessionOwners: session.incarnationId ? (session.agentSessionOwners ?? []) : [],
          spawnPaneKey: session.paneKey ?? null,
          ...(session.wslDistro !== undefined
            ? { isWsl: Boolean(session.wslDistro), wslDistro: session.wslDistro }
            : {}),
          ...(restoresExactSurface
            ? { tabId: persistedSurface.tabId, paneKey: persistedSurface.paneKey }
            : {})
        })
        if (restoresExactSurface && controllerIdentity) {
          this.rememberRestoredOrchestrationAuthority(
            pty,
            controllerIdentity.handle,
            controllerIdentity.incarnationId
          )
        } else {
          this.restoredOrchestrationAuthorityByPtyId.delete(session.id)
        }
        pty.controllerTitle = session.title?.trim() || null
        this.mainDaemonAttachments.reconcile(session.id)
        this.reconcileRestoredWorkingTitleMonitor(session.id)
      }
      // Do not serialize relay probes or let one throw abort inventory cleanup.
      if (inventoryOptions?.refreshForegroundAgents !== false) {
        this.refreshPtyForegroundAgent(session.id)
      }
    }
    for (const pty of this.ptysById.values()) {
      if (connectionId !== undefined && pty.connectionId !== connectionId) {
        continue
      }
      const encodedHostId = getPtyExecutionHost(pty.ptyId)
      const ptyHostId =
        encodedHostId === 'foreign'
          ? null
          : (encodedHostId ?? getConnectionExecutionHostId(pty.connectionId))
      if (!ptyHostId) {
        continue
      }
      // An inventory can prove absence only for hosts that actually answered.
      if (!queriedHostIds.has(ptyHostId)) {
        if (this.isSshOwnedPtyId(pty.ptyId) && this.ptyController?.hasPty?.(pty.ptyId) == null) {
          this.markPtyLivenessUnverifiable(pty.ptyId, NO_OBSERVING_PROVIDER_REASON)
        }
        continue
      }
      if (
        !allLivePtyIds.has(pty.ptyId) &&
        (this.mainDecidesLiveness(pty.worktreeId) || !this.leafExistsForPty(pty.ptyId))
      ) {
        const currentVerdict = this.ptyLivenessVerdictByPtyId.get(pty.ptyId)
        if (
          currentVerdict &&
          currentVerdict.observedAt > livenessObservationAtStart &&
          currentVerdict.verdict.status === 'unverifiable'
        ) {
          this.setPtyConnected(pty, false)
          continue
        }
        const observed = this.ptyController?.hasPty?.(pty.ptyId)
        if (observed === true) {
          // Why: an SSH spawn can become addressable before an overlapping relay list includes it.
          allLivePtyIds.add(pty.ptyId)
          if (
            !targetWorktreeId ||
            (pty.worktreeId && worktreeIdsEqual(pty.worktreeId, targetWorktreeId))
          ) {
            selectedLivePtyIds.add(pty.ptyId)
          }
          this.setPtyConnected(pty, true)
          this.markPtyLivenessLive(pty.ptyId, livenessObservationAtStart)
          continue
        }
        this.setPtyConnected(pty, false)
        pty.agentSessionOwners = []
        // Registered-provider inventory omits dropped relays: false means observed absence, null means no provider answered.
        if (observed === false) {
          // A restarted relay can omit surviving shells; its session map cannot prove exit.
          this.forgetPtyLivenessVerdict(pty.ptyId)
        } else if (observed === null && this.isSshOwnedPtyId(pty.ptyId)) {
          this.markPtyLivenessUnverifiable(pty.ptyId, NO_OBSERVING_PROVIDER_REASON)
        }
      }
    }
    // Why: runs after the hasPty rescue so a still-addressable pane keeps its receipt.
    retireOrchestrationAuthorityAbsentFromInventory(this.restoredOrchestrationAuthorityByPtyId, {
      queriedHostIds,
      allLivePtyIds,
      connectionId
    })
    this.pruneDisconnectedPtyRecords()
    this.followExportedPaneKeys()
    return {
      livePtyIds: targetWorktreeId ? selectedLivePtyIds : allLivePtyIds,
      allLivePtyIds,
      terminalIdentityByPtyId: controllerIdentityByPtyId,
      queriedHostIds,
      // Switch point: main places live terminals itself and must skip ones being killed.
      ...(ORCA_LAYOUT_OWNER_IS_MAIN ? { exitingPtyIds: exitingPtyIdsOf(sessions) } : {})
    }
  }
}
