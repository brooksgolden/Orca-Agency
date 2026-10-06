// @ts-nocheck -- mechanically split from OrcaRuntimeService; behavior is covered by AST equivalence and characterization tests.
import { OrcaRuntimeWithEmitDaemonPtyTransientFact } from './orca-runtime-emit-daemon-pty-transient-fact'
import { getDecorativeAgentTitleSignature } from '../../shared/agent-decorative-title-signature'
import { shouldEmitTitleFactForFrame } from './decorative-title-fact-emission'
import type { RuntimePtyTitleTrackerEntry } from './runtime-terminal-state-records'
import { createTerminalTitleTracker } from '../../shared/terminal-output-side-effects'
import { detectAgentStatusFromTitle } from '../../shared/agent-detection'
import { AGENT_WORKING_TITLE_REFRESH_AFTER_MS } from '../../shared/agent-working-title-freshness'
import { isCancelledCodexStatus } from '../../shared/codex-cancelled-status-recovery'
import { resolveAgentStatusBinding } from '../ipc/agent-status-ipc-boundary'
import { pruneOldestMapEntry } from './prune-oldest-map-entry'
import type { TerminalGitHubPRLink } from '../../shared/terminal-github-pr-link-detector'

export class OrcaRuntimeWithGetUnpersistedTrackedTitleForPty extends OrcaRuntimeWithEmitDaemonPtyTransientFact {
  private readonly restoredWorkingTitleMonitors = new Map<string, string>()

  protected reconcileRetainedProviderAttach(ptyId: string): void {
    this.reconcileSubscriberDrivenProviderAttach(ptyId)
    this.reconcileRestoredWorkingTitleMonitor(ptyId)
  }

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
      this.terminalViewSubscribers.hasPendingProviderAttach(ptyId) ||
      (row.terminalHandle && row.terminalHandle !== binding.terminalHandle) ||
      this.restoredWorkingTitleMonitors.get(ptyId) === binding.processIncarnation
    ) {
      return
    }
    const attach = this.ptyController?.attach
    if (!attach) {
      return
    }
    const incarnation = binding.processIncarnation
    this.restoredWorkingTitleMonitors.set(ptyId, incarnation)
    pruneOldestMapEntry(this.restoredWorkingTitleMonitors, 512)
    // Reattach only the inventory-proven local PTY; fresh native bytes confirm status.
    void attach(ptyId)
      .catch(() => false)
      .then((attached) => {
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

  /** Why: synthetic agent title frames no longer ride pty:data, so neither
   *  renderer xterm nor the headless emulator observes them. Mobile-parity
   *  snapshot titles must prefer main's tracker over snapshot lastTitle, or
   *  hook-driven spinner/idle titles vanish from mobile tabs. */
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

  /** Decorative comparison key: only recognized agent titles fold leading spinner frames. */
  protected makeDecorativeTitleGateKey(rawTitle: string, normalizedTitle: string): string {
    // Stable Pi/Gemini/Grok display normalization also defines their semantic gate.
    const normalizedSignature =
      rawTitle === normalizedTitle ? null : getDecorativeAgentTitleSignature(normalizedTitle)
    const signature = normalizedSignature ?? getDecorativeAgentTitleSignature(rawTitle)
    return signature === null ? `literal\u0000${normalizedTitle}` : `agent\u0000${signature}`
  }

  protected getOrCreatePtyTitleTrackerEntry(ptyId: string): RuntimePtyTitleTrackerEntry {
    const existing = this.ptyTitleTrackersByPtyId.get(ptyId)
    if (existing) {
      return existing
    }
    // Why: trackers are created lazily on the first observed chunk. After an
    // app relaunch the PTY/leaf records can already hold a persisted title; a
    // cold tracker would miss the parked working→idle completion and never
    // arm the stale-title timer for a persisted 'working' title.
    let initialTitle = this.ptysById.get(ptyId)?.lastOscTitle ?? null
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
          if (live) {
            live.lastMobileTitleGateKey = gateKey
          }
          // Why: the same gate the mobile fan-out below already uses, applied one hop earlier —
          // a spinner frame the renderer store discards should not cost a pty:sideEffect message
          // at all. See decorative-title-fact-emission.ts for why repeats still heartbeat.
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
            // Only captured native Codex working frames can confirm silent hooks.
            const pty = this.ptysById.get(ptyId)
            const owner = pty?.foregroundAgent ?? pty?.launchAgent
            if (
              live?.applyingChunk &&
              !meta?.syntheticTitle &&
              !meta?.staleWorkingTitleClear &&
              owner === 'codex' &&
              detectAgentStatusFromTitle(rawTitle) === 'working'
            ) {
              this.runAfterPendingTerminalSideEffectFacts(ptyId, () => {
                const paneKey = this.resolveTerminalSideEffectAttribution(ptyId).paneKey
                if (!paneKey) {
                  return
                }
                const observed = this.readObservedAgentStatusPaneIdentityFn(paneKey)
                const current = resolveAgentStatusBinding(paneKey, this)
                const row = (this.getAgentProviderSessionRowsForPaneFn?.(paneKey) ?? []).find(
                  (row) =>
                    row.agentType === 'codex' &&
                    (row.state === 'working' || isCancelledCodexStatus(row))
                )
                // Why: an inferred Escape cancellation can outlive a recovered compact. Only
                // fresh provider bytes from the already observed process can contradict it.
                const recoversCancelled =
                  row &&
                  isCancelledCodexStatus(row) &&
                  !row.restoredUnconfirmed &&
                  this.graphStatus === 'ready' &&
                  observed.kind === 'observed' &&
                  current.kind === 'pane' &&
                  this.ptysById.get(ptyId)?.connected === true &&
                  (row.connectionId ?? null) === null &&
                  (this.ptysById.get(ptyId)?.connectionId ?? null) === null &&
                  this.ptysById.get(ptyId)?.lastAgentStatus === 'working' &&
                  this.ptysById.get(ptyId)?.lastAgentStatusObservedLive === true
                const confirmsRestored =
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
                      observed.dispatchId !==
                        (current.kind === 'worker' ? current.dispatchId : null)
                    : !confirmsRestored) ||
                  !row ||
                  (row.restoredUnconfirmed && !confirmsRestored) ||
                  (!confirmsRestored &&
                    !recoversCancelled &&
                    nowMs - (row.evidenceObservedAt ?? row.receivedAt) <=
                      AGENT_WORKING_TITLE_REFRESH_AFTER_MS)
                ) {
                  return
                }
                this.emitTerminalAgentStatusEvents(
                  ptyId,
                  { payloads: [{ state: 'working', prompt: '', agentType: 'codex' }] },
                  {
                    evidenceOnly: true,
                    observedTerminalHandle: current.terminalHandle,
                    ...(recoversCancelled ? { recoverCancelledWorkingTitle: true } : {}),
                    ...(confirmsRestored
                      ? {
                          confirmRestoredWorkingTitle: true,
                          restoredLaunchToken: this.ptysById.get(ptyId)?.launchToken ?? undefined
                        }
                      : {})
                  }
                )
              })
            }
          }
          const changed = this.applyTrackedPtyTitle(ptyId, rawTitle, normalizedTitle, meta)
          const identityOnlyTitle = this.isLiveCursorNativeTitle(rawTitle, meta)
          const tracksReplicatedStatus =
            live?.applyingChunk === true && this.mobileSessionTabListeners.size > 0
          const titleStatus = tracksReplicatedStatus ? detectAgentStatusFromTitle(rawTitle) : null
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
            // Why: synthetic spinner ticks change only the braille glyph
            // ~12.5x/sec; fanning out full mobile session snapshots per frame
            // is pure churn. Raw lastOscTitle updates above stay cheap.
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
            ...(meta?.staleWorkingTitleClear ? { staleWorkingTitleClear: true } : {})
          })
        },
        onAgentExited: () => {
          this.confirmPtyAgentExit(ptyId)
        },
        onCommandStarted: () => {
          this.openCodeRunLifetime.onCommandStarted(ptyId)
        },
        onCommandFinished: (exitCode: number | null) => {
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
      // Why: command-code facts exist only for the pty:sideEffect channel —
      // headless serve skips the per-chunk scrape entirely. The detector
      // self-arms on the Command Code banner; the spawn command (when main
      // saw one) mirrors the renderer detector's startupCommand fast-arm.
      commandCodeDetector: this.terminalSideEffectConsumerAvailable
        ? this.createTerminalSideEffectCommandCodeDetector(ptyId)
        : null
    }
    this.ptyTitleTrackersByPtyId.set(ptyId, entry)
    return entry
  }
}
