/* eslint-disable max-lines -- Why: Title tracking keeps frame qualification, decorative-title gates, and transient fact emission together. */
import type { TerminalTitleFactMeta } from '../../../../shared/terminal-output-side-effects'
import { OrcaRuntimeWithEmitDaemonPtyTransientFact } from './terminal-transient-facts'
import { getDecorativeTitleGateKey } from '../../../../shared/agent-decorative-title-signature'
import { shouldEmitTitleFactForFrame } from '../../decorative-title-fact-emission'
import type { RuntimePtyTitleTrackerEntry } from '../../runtime-terminal-state-records'
import { createTerminalTitleTracker } from '../../../../shared/terminal-output-side-effects'
import {
  detectAgentStatusFromTitle,
  isQuarterCircleSpinnerOnlyAgentTitle,
  type AgentStatus
} from '../../../../shared/agent-detection'
import { CLAUDE_IDLE } from '../../../../shared/agent-title-core'
import { resolveExplicitTerminalTitleAgentType } from '../../../../shared/terminal-title-agent-type'
import { AGENT_WORKING_TITLE_REFRESH_AFTER_MS } from '../../../../shared/agent-working-title-freshness'
import { isCancelledCodexStatus } from '../../../../shared/codex-cancelled-status-recovery'
import {
  resolveAgentStatusBinding,
  type AgentStatusRuntimeEnrichment
} from '../../../ipc/agent-status-ipc-boundary'
import type { TuiAgent } from '../../../../shared/tui-agent'
import type { TerminalGitHubPRLink } from '../../../../shared/terminal-github-pr-link-detector'
import { scheduleNativeIdleTitleSettlement } from '../../native-idle-title-settlement'
import { INTERRUPTED_DONE_LATE_WORKING_SUPPRESSION_MS } from '../../../agent-hooks/server/server-constants'

export abstract class OrcaRuntimeWithGetUnpersistedTrackedTitleForPty extends OrcaRuntimeWithEmitDaemonPtyTransientFact {
  abstract getAgentStatusTerminalHandleForPaneKey(
    ...args: Parameters<AgentStatusRuntimeEnrichment['getAgentStatusTerminalHandleForPaneKey']>
  ): ReturnType<AgentStatusRuntimeEnrichment['getAgentStatusTerminalHandleForPaneKey']>
  abstract getAgentStatusOrchestrationContextForPaneKey(
    ...args: Parameters<
      AgentStatusRuntimeEnrichment['getAgentStatusOrchestrationContextForPaneKey']
    >
  ): ReturnType<AgentStatusRuntimeEnrichment['getAgentStatusOrchestrationContextForPaneKey']>
  abstract getLocalTerminalAgentForPane(paneKey: string): TuiAgent | null
  protected abstract recheckHookAgentPresenceForPty(
    ptyId: string,
    exitedSince?: number
  ): Promise<'live' | 'unverifiable' | 'exited' | null>
  protected abstract applyTrackedPtyTitle(
    ptyId: string,
    rawTitle: string,
    normalizedTitle: string,
    meta?: TerminalTitleFactMeta
  ): boolean
  protected abstract confirmPtyAgentExit(ptyId: string, recoverCompletedHook?: boolean): void
  protected abstract classifyPtyTitleStatus(ptyId: string, rawTitle: string): AgentStatus | null
  protected abstract applyPtyProgramActivity(ptyId: string, activity: AgentStatus | null): void
  protected abstract createTerminalSideEffectCommandCodeDetector(
    ptyId: string
  ): NonNullable<RuntimePtyTitleTrackerEntry['commandCodeDetector']>

  protected getUnpersistedTrackedTitleForPty(ptyId: string | null): string | null {
    if (!ptyId || this.getTrackedRawTitleForPty(ptyId) !== null) {
      return null
    }
    // Why: a manual title is authoritative until explicitly cleared with null.
    const pty = this.ptysById.get(ptyId)
    if (pty && pty.title !== null) {
      return null
    }
    return this.ptyTitleTrackersByPtyId.get(ptyId)?.tracker.getLastNormalizedTitle() ?? null
  }

  /** Synthetic hook titles bypass both xterms; mobile snapshots must prefer main's tracker over serialized lastTitle. */
  protected preferTrackedLastTitle<T extends { lastTitle?: string }>(
    ptyId: string,
    snapshot: T
  ): T {
    const tracked = this.getTrackedDisplayTitleForPty(ptyId)
    if (!tracked) {
      return snapshot
    }
    return { ...snapshot, lastTitle: tracked }
  }

  /** Decorative comparison key: only recognized agent titles fold spinner frames. */
  protected makeDecorativeTitleGateKey(rawTitle: string, normalizedTitle: string): string {
    return getDecorativeTitleGateKey(rawTitle, normalizedTitle)
  }

  protected getOrCreatePtyTitleTrackerEntry(ptyId: string): RuntimePtyTitleTrackerEntry {
    const existing = this.ptyTitleTrackersByPtyId.get(ptyId)
    if (existing) {
      return existing
    }
    // Why: trackers are created lazily on the first observed chunk. After an
    // app relaunch the PTY/leaf records can already hold a persisted title; a
    // cold tracker would miss the parked working-to-idle completion and never
    // arm the stale-title timer for a persisted 'working' title.
    // Seed cold trackers from persisted titles for completion/stale-working timers; prefer an existing display clear so retired spinners stay retired.
    const pty = this.ptysById.get(ptyId)
    let initialTitle = pty?.titleDisplayClear?.title ?? pty?.lastOscTitle ?? null
    if (initialTitle === null) {
      for (const leaf of this.getLeavesForPty(ptyId)) {
        if (leaf.lastOscTitle) {
          initialTitle = leaf.lastOscTitle
          break
        }
      }
    }
    const tracker = createTerminalTitleTracker(
      {
        onTitle: (normalizedTitle, rawTitle, meta) => {
          const live = this.ptyTitleTrackersByPtyId.get(ptyId)
          const gateKey = this.makeDecorativeTitleGateKey(rawTitle, normalizedTitle)
          const decorativeOnly = live?.lastMobileTitleGateKey === gateKey
          if (!decorativeOnly && !meta?.staleWorkingTitleClear) {
            void this.recheckHookAgentPresenceForPty(ptyId)
          }
          if (live) {
            live.lastMobileTitleGateKey = gateKey
            if (!meta?.staleWorkingTitleClear) {
              live.lastTitle = { raw: rawTitle, normalized: normalizedTitle }
            }
          }
          // Suppress decorative side-effect churn one hop before renderer dedupe; repeats still heartbeat (decorative-title-fact-emission.ts).
          const nowMs = Date.now()
          if (
            shouldEmitTitleFactForFrame({
              decorativeOnly,
              staleWorkingTitleClear: meta?.staleWorkingTitleClear === true,
              lastEmittedAtMs: live?.lastTitleFactAtMs ?? null,
              nowMs
            })
          ) {
            if (live) {
              live.lastTitleFactAtMs = nowMs
            }
            this.recordTerminalSideEffectFact(ptyId, {
              kind: 'title',
              normalizedTitle,
              rawTitle,
              ...(meta?.staleWorkingTitleClear ? { staleWorkingTitleClear: true } : {})
            })
          }
          // Captured native state can repair silent hooks on the same observed process.
          const pty = this.ptysById.get(ptyId)
          const owner = pty?.launchAgent ?? pty?.foregroundAgent
          const nativeStatus = detectAgentStatusFromTitle(rawTitle)
          const explicitOwner = resolveExplicitTerminalTitleAgentType(rawTitle)
          const claudeFrame =
            rawTitle.startsWith(CLAUDE_IDLE) || isQuarterCircleSpinnerOnlyAgentTitle(rawTitle)
          if (
            live?.applyingChunk &&
            !meta?.syntheticTitle &&
            !meta?.staleWorkingTitleClear &&
            (owner === 'codex' || owner === 'claude') &&
            (explicitOwner === null || explicitOwner === owner) &&
            (owner === 'claude' ? claudeFrame || explicitOwner === owner : !claudeFrame) &&
            (nativeStatus === 'working' || (owner === 'claude' && nativeStatus === 'idle'))
          ) {
            const reconcile = () => {
              const paneKey = this.resolveTerminalSideEffectAttribution(ptyId).paneKey
              if (!paneKey) {
                return
              }
              const observed = this.readObservedAgentStatusPaneIdentityFn(paneKey)
              const current = resolveAgentStatusBinding(paneKey, this)
              const row = (this.getAgentProviderSessionRowsForPaneFn?.(paneKey) ?? []).find(
                (row) =>
                  row.agentType === owner && (row.state === 'working' || row.state === 'done')
              )
              // Why: an inferred Escape cancellation can outlive a recovered compact. Only
              // fresh provider bytes from the already observed process can contradict it.
              const recoversSettled =
                row &&
                row.state === 'done' &&
                row.sessionBoundary !== true &&
                !row.restoredUnconfirmed &&
                this.graphStatus === 'ready' &&
                observed.kind === 'observed' &&
                current.kind === 'pane' &&
                this.getLocalTerminalAgentForPane(paneKey) === owner &&
                this.ptysById.get(ptyId)?.connected === true &&
                (row.connectionId ?? null) === null &&
                (this.ptysById.get(ptyId)?.connectionId ?? null) === null &&
                this.ptysById.get(ptyId)?.lastAgentStatus === 'working' &&
                this.ptysById.get(ptyId)?.lastAgentStatusObservedLive === true
              const recoversCancelled = recoversSettled && isCancelledCodexStatus(row)
              const settlesIdle =
                owner === 'claude' &&
                nativeStatus === 'idle' &&
                row?.state === 'working' &&
                !row.restoredUnconfirmed &&
                this.graphStatus === 'ready' &&
                observed.kind === 'observed' &&
                current.kind === 'pane' &&
                this.getLocalTerminalAgentForPane(paneKey) === owner &&
                this.ptysById.get(ptyId)?.connected === true &&
                this.ptysById.get(ptyId)?.lastAgentStatus === 'idle' &&
                this.ptysById.get(ptyId)?.lastAgentStatusObservedLive === true &&
                (row.connectionId ?? null) === null &&
                (this.ptysById.get(ptyId)?.connectionId ?? null) === null
              const confirmsRestored =
                row?.state === 'working' &&
                row?.restoredUnconfirmed === true &&
                this.graphStatus === 'ready' &&
                current.kind === 'pane' &&
                (!row.terminalHandle || row.terminalHandle === current.terminalHandle) &&
                this.ptysById.get(ptyId)?.connected === true &&
                (row.connectionId ?? null) === null &&
                (this.ptysById.get(ptyId)?.connectionId ?? null) === null &&
                this.ptysById.get(ptyId)?.lastAgentStatus === 'working' &&
                this.ptysById.get(ptyId)?.lastAgentStatusObservedLive === true
              if (
                current.kind === 'unresolved' ||
                (observed.kind === 'observed'
                  ? observed.terminalHandle !== current.terminalHandle ||
                    observed.processIncarnation !== current.processIncarnation ||
                    observed.dispatchId !== (current.kind === 'worker' ? current.dispatchId : null)
                  : !confirmsRestored) ||
                !row ||
                (row.restoredUnconfirmed && !confirmsRestored) ||
                (!confirmsRestored &&
                  !recoversCancelled &&
                  !recoversSettled &&
                  !settlesIdle &&
                  nowMs - (row.evidenceObservedAt ?? row.receivedAt) <=
                    AGENT_WORKING_TITLE_REFRESH_AFTER_MS)
              ) {
                return
              }
              const idleDelayMs =
                INTERRUPTED_DONE_LATE_WORKING_SUPPRESSION_MS + 1 - (Date.now() - row.receivedAt)
              if (settlesIdle && idleDelayMs > 0 && current.kind === 'pane') {
                const expectedRowAt = row.receivedAt
                const expectedIncarnation = current.processIncarnation
                // Let a new turn's native spinner supersede a late idle frame before settling it.
                scheduleNativeIdleTitleSettlement(this, ptyId, idleDelayMs, () => {
                  const latest = (this.getAgentProviderSessionRowsForPaneFn?.(paneKey) ?? []).find(
                    (entry) => entry.agentType === owner && entry.state === 'working'
                  )
                  const binding = resolveAgentStatusBinding(paneKey, this)
                  if (
                    latest?.receivedAt === expectedRowAt &&
                    binding.kind === 'pane' &&
                    binding.processIncarnation === expectedIncarnation &&
                    this.ptysById.get(ptyId)?.lastAgentStatus === 'idle'
                  ) {
                    reconcile()
                  }
                })
                return
              }
              this.emitTerminalAgentStatusEvents(
                ptyId,
                {
                  payloads: [
                    {
                      state: nativeStatus === 'idle' ? 'done' : 'working',
                      prompt: '',
                      agentType: owner
                    }
                  ]
                },
                {
                  evidenceOnly: true,
                  observedTerminalHandle: current.terminalHandle,
                  ...(settlesIdle ? { settleNativeIdleTitle: true } : {}),
                  ...(recoversCancelled ? { recoverCancelledWorkingTitle: true } : {}),
                  ...(recoversSettled ? { recoverSettledWorkingTitle: true } : {}),
                  ...(confirmsRestored
                    ? {
                        confirmRestoredWorkingTitle: true,
                        restoredLaunchToken: this.ptysById.get(ptyId)?.launchToken ?? undefined
                      }
                    : {})
                }
              )
            }
            this.runAfterPendingTerminalSideEffectFacts(ptyId, reconcile)
          }
          const changed = this.applyTrackedPtyTitle(ptyId, rawTitle, normalizedTitle, meta)
          const identityOnlyTitle = this.isLiveCursorNativeTitle(rawTitle, meta)
          const tracksReplicatedStatus =
            live?.applyingChunk === true && this.mobileSessionTabListeners.size > 0
          const titleStatus = tracksReplicatedStatus
            ? this.classifyPtyTitleStatus(ptyId, rawTitle)
            : null
          if (
            tracksReplicatedStatus &&
            decorativeOnly &&
            !this.ptyForegroundAgent.hasDelayedSnapshot(ptyId) &&
            (titleStatus === 'working' || titleStatus === 'permission')
          ) {
            // Normalized Pi/Gemini/Grok frames still renew the replicated status lease.
            this.mobileSessionTabsAgentStatusHeartbeat.scheduleDecorativeHeartbeat(ptyId)
          }
          // Why: an identity-only cursor title records nothing, but the tracker
          // title is that pane's only Cursor identity and must still fan out (#10258).
          if (!changed && !identityOnlyTitle) {
            return
          }
          if (live?.applyingChunk) {
            // Synthetic spinner glyphs tick ~12.5Hz; update cheap title records without publishing whole mobile snapshots.
            if (!decorativeOnly) {
              this.mobileSessionTabsAgentStatusHeartbeat.observeSemanticTitle(ptyId)
              live.chunkTouchedSessionTabs = true
            }
          } else {
            // Stale-working-title timer path — fires between chunks, so the
            // per-chunk batching in onPtyData cannot pick it up.
            this.mobileSessionTabsAgentStatusHeartbeat.observeSemanticTitle(ptyId)
            this.touchMobileSessionSnapshotsForPty(ptyId)
          }
        },
        // Why: agent transitions and bells become pty:sideEffect facts —
        // main is the single byte parser for local/SSH PTYs; the renderer
        // store handler decides what the facts mean (notification policy).
        onAgentBecameWorking: () => {
          this.recordTerminalSideEffectFact(ptyId, { kind: 'agent-working' })
        },
        onAgentBecameIdle: (title, meta) => {
          this.recordTerminalSideEffectFact(ptyId, {
            kind: 'agent-idle',
            title,
            ...(meta?.status ? { status: meta.status } : {}),
            ...(meta?.staleWorkingTitleClear ? { staleWorkingTitleClear: true } : {})
          })
        },
        onAgentExited: () => {
          this.confirmPtyAgentExit(ptyId)
        },
        onProgramActivity: (activity) => {
          this.applyPtyProgramActivity(ptyId, activity)
        },
        onCommandStarted: () => {
          this.openCodeRunLifetime.onCommandStarted(ptyId)
        },
        onCommandFinished: (exitCode: number | null) => {
          void this.recheckHookAgentPresenceForPty(ptyId)
          this.retirePtyAgentLaunchAuthority(ptyId)
          this.recordTerminalSideEffectFact(ptyId, { kind: 'command-finished', exitCode })
          this.openCodeRunLifetime.onCommandFinished(ptyId, exitCode)
        },
        onBell: () => {
          this.recordTerminalSideEffectFact(ptyId, { kind: 'bell' })
        },
        onPrLink: (link: TerminalGitHubPRLink) => {
          this.recordTerminalSideEffectFact(ptyId, { kind: 'pr-link', link })
        },
        // Why: hidden-delivery-gated views never see 2031 bytes; facts keep their theme registry truthful.
        onMode2031Subscribe: () => {
          this.recordTerminalSideEffectFact(ptyId, { kind: '2031-subscribe' })
        },
        onMode2031Unsubscribe: () => {
          this.recordTerminalSideEffectFact(ptyId, { kind: '2031-unsubscribe' })
        }
      },
      initialTitle !== null ? { initialTitle } : {}
    )
    tracker.setTransientSideEffectScanningEnabled(this.terminalSideEffectConsumerAvailable)
    const entry: RuntimePtyTitleTrackerEntry = {
      tracker,
      applyingChunk: false,
      lastMobileTitleGateKey: null,
      lastTitleFactAtMs: null,
      chunkTouchedSessionTabs: false,
      pendingFacts: [],
      afterFacts: [],
      // Headless serve has no side-effect consumer, so skip Command Code scraping; otherwise arm from launch command or banner.
      commandCodeDetector: this.terminalSideEffectConsumerAvailable
        ? this.createTerminalSideEffectCommandCodeDetector(ptyId)
        : null,
      programActivity: null,
      // The persisted title is already normalized, so it stands for both forms.
      lastTitle: initialTitle !== null ? { raw: initialTitle, normalized: initialTitle } : null
    }
    this.ptyTitleTrackersByPtyId.set(ptyId, entry)
    return entry
  }
}
