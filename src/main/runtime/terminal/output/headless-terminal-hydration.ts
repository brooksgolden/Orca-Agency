import type {
  RuntimeHeadlessTerminal,
  RuntimePtyWorktreeRecord
} from '../../runtime-terminal-state-records'
import type { AgentStatusIpcPayload } from '../../../../shared/agent-status-types'
import { splitFreebuffScreenUpdates } from '../../../../shared/freebuff-screen-status'
import { OrcaRuntimeWithSerializeMainTerminalBuffer } from './terminal-buffer-operations'
import { observeFreebuffTerminalStatus } from '../../freebuff-terminal-status'
import {
  observeCodexCapacityTerminalStatus,
  observeCodexReconnectFailure
} from '../../codex-notice-terminal-status'
import { TrustDialogStatusObserver } from '../../trust-dialog-status-observer'
import type { LaunchedAgentForeground } from '../../launched-agent-foreground'
import type { TuiAgent } from '../../../../shared/tui-agent'
import {
  detectAgentStatusFromTitle,
  normalizeTerminalTitle
} from '../../../../shared/agent-detection'
import { shouldModelAnswerHiddenPtyQueries } from '../../terminal-model-query-authority'
import { advancePartialEscapeTail } from '../../../../shared/terminal-partial-escape-tail'
import { TrailingTerminalOutputCapture } from '../../terminal-output-trailing-capture'
import { getOutputAfterSnapshotSeq } from '../../rpc/methods/terminal/terminal-stream-replay'

export abstract class OrcaRuntimeWithMaybeHydrateHeadlessFromRenderer extends OrcaRuntimeWithSerializeMainTerminalBuffer {
  protected abstract getOrCreateHeadlessTerminal(ptyId: string): RuntimeHeadlessTerminal
  protected abstract markPaneLiveTitlesDirty(): void
  protected abstract settleLostAgentSession(ptyId: string): void
  abstract readLaunchedAgentForeground(
    ptyId: string,
    agent: TuiAgent
  ): Promise<LaunchedAgentForeground>

  protected readonly trustDialogStatus = new TrustDialogStatusObserver({
    getPaneAgent: (ptyId) => this.getPaneAgentForTuiIdle(ptyId),
    refreshForegroundAgent: (ptyId) => this.ptyForegroundAgent.refresh(ptyId),
    readLaunchedAgentForeground: (ptyId, agent) => this.readLaunchedAgentForeground(ptyId, agent),
    getEmulator: (ptyId) =>
      this.ptysById.has(ptyId) ? this.headlessTerminals.get(ptyId)?.emulator : undefined,
    readStatus: (ptyId) => {
      const pty = this.ptysById.get(ptyId)
      return pty ? this.readPtyAgentStatusRow(ptyId, pty) : undefined
    },
    publish: (ptyId, payload) =>
      this.emitTerminalAgentStatusEvents(
        ptyId,
        { cleanData: '', payloads: [payload], lastPayloadCleanOffset: null },
        undefined,
        false
      )
  })

  // Create emulator state synchronously and chain renderer hydration first so concurrent live bytes cannot be overwritten by a late seed (docs/mobile-prefer-renderer-scrollback.md).
  maybeHydrateHeadlessFromRenderer(
    ptyId: string,
    beforeChunkSequence = this.getPtyOutputSequence(ptyId)
  ): Promise<boolean> | null {
    const hydration = this.headlessHydrationState.get(ptyId)
    if (hydration === 'pending' || hydration === 'done') {
      return null
    }
    const providerSnapshotPreferred = this.providerSnapshotPreferredPtys.has(ptyId)
    if (
      this.headlessTerminals.has(ptyId) &&
      !providerSnapshotPreferred &&
      hydration !== 'awaiting-serializer'
    ) {
      // Daemon-snapshot seed already populated the emulator — skip hydration.
      this.headlessHydrationState.set(ptyId, 'done')
      return null
    }
    const controller = this.ptyController
    if (!controller?.serializeBuffer || !controller.hasRendererSerializer) {
      return null
    }
    if (!controller.hasRendererSerializer(ptyId)) {
      // Renderer hasn't registered yet (or never will). Live writes lazy-
      // create the state via trackHeadlessTerminalData on this same tick.
      return null
    }

    const state = this.getOrCreateHeadlessTerminal(ptyId)
    const generation = this.getPtyLifecycleGeneration(ptyId)
    const isCurrent = () =>
      this.headlessTerminals.get(ptyId) === state &&
      this.getPtyLifecycleGeneration(ptyId) === generation
    const trailing = new TrailingTerminalOutputCapture(beforeChunkSequence)
    const unsubscribe = this.subscribeToTerminalData(ptyId, (data, meta) =>
      trailing.push(data, meta)
    )
    this.headlessHydrationState.set(ptyId, 'pending')

    // Queue seed before live writes on the same state; awaiting before publishing state would lose concurrent bytes.
    let seeded = false
    state.writeChain = state.writeChain.then(async () => {
      let candidate: RuntimeHeadlessTerminal | undefined
      try {
        if (!isCurrent()) {
          return
        }
        // Retain normal-buffer scrollback while a TUI is in alt-screen so pre-TUI history remains restorable (#6106).
        // This emulator's retention: a hidden-output reveal repaints the pane from this model.
        const rendered = await controller.serializeBuffer!(ptyId, {
          scrollbackRows: this.headlessTerminalScrollbackRows
        })
        if (!isCurrent() || !rendered || rendered.data.length === 0) {
          return
        }
        if (
          typeof rendered.seq === 'number' &&
          (rendered.seq < state.outputSequence ||
            rendered.seq > this.getPtyOutputSequence(ptyId) ||
            trailing.after(rendered.seq) === null)
        ) {
          return
        }
        // Stage the seed so failure or retirement preserves the incumbent model and its queued bytes.
        candidate = this.createPtyHeadlessTerminalState(ptyId, rendered)
        await candidate.emulator.write(rendered.data)
        if (!isCurrent()) {
          return
        }
        const ptyDims = this.getTerminalSize(ptyId)
        if (ptyDims && (ptyDims.cols !== rendered.cols || ptyDims.rows !== rendered.rows)) {
          candidate.emulator.resize(ptyDims.cols, ptyDims.rows)
        }
        // Synthetic hook titles bypass xterm; prefer main's tracked title, using renderer title only for a cold tracker.
        candidate.ownership.seedOwner(undefined, {
          alternateScreen: candidate.emulator.isAlternateScreen
        })
        const seedTitle = this.getTrackedRawTitleForPty(ptyId) ?? rendered.lastTitle
        if (seedTitle) {
          candidate.emulator.setLastTitle(seedTitle)
        }
        state.emulator.disableQueryReplyForwarding()
        state.emulator.dispose()
        state.ownership.dispose()
        state.emulator = candidate.emulator
        state.ownership = candidate.ownership
        // The stable chain owner carries live writes already covered by the renderer snapshot.
        state.rendererSeedSeq = rendered.seq
        state.rendererSeedEscapeTail = undefined
        state.outputSequence = rendered.seq ?? state.outputSequence
        seeded = true
        this.recordOsc7MetadataForPty(ptyId, rendered.data)
        this.recordRecentPtyOutput(ptyId, rendered.data)
        if (seedTitle) {
          this.applySeededAgentStatus(ptyId, seedTitle)
        }
        this.providerSnapshotPreferredPtys.delete(ptyId)
      } catch {
        // Hydration is best-effort. Live writes continue via the same
        // writeChain that this catch-arm leaves intact.
      } finally {
        unsubscribe()
        if (candidate && !seeded) {
          candidate.ownership.dispose()
          candidate.emulator.dispose()
        }
        if (isCurrent()) {
          this.headlessHydrationState.set(ptyId, seeded ? 'done' : 'awaiting-serializer')
        }
      }
    })
    return state.writeChain.then(() => seeded)
  }

  // Historical seeds update display status only, never live evidence, waiters or orchestration delivery.
  protected applySeededAgentStatus(ptyId: string, title: string): void {
    if (!title) {
      return
    }
    // Seed cold title trackers for completion/stale-working timers; observed live titles always win.
    this.getOrCreatePtyTitleTrackerEntry(ptyId).tracker.seedInitialTitle(title)
    const status = detectAgentStatusFromTitle(title)
    // Store normalized title evidence like live output; display clears still project over native working titles.
    const seededTitle = normalizeTerminalTitle(title)
    const pty = this.ptysById.get(ptyId)
    if (pty) {
      const observedAt = this.nextTitleObservationSequence()
      pty.lastOscTitle = seededTitle
      pty.lastOscTitleAt = observedAt
      this.setPtyManagementTitleFromObservedTitle(pty, seededTitle, observedAt)
    }
    for (const leaf of this.getLeavesForPty(ptyId)) {
      // Seed even non-agent titles so worktree.ps can reclassify instead of treating the pane as agentless.
      leaf.lastOscTitle = seededTitle
      leaf.lastOscTitleAt = this.nextTitleObservationSequence()
      if (status !== null) {
        leaf.lastAgentStatus = status
      }
    }
    this.markPaneLiveTitlesDirty()
  }

  /** Capture reply ownership synchronously at ingestion; never re-read it when the queued write runs. */
  protected shouldAnswerQueriesForLiveChunk(ptyId: string): boolean {
    return shouldModelAnswerHiddenPtyQueries({
      ptyId,
      settings: this.store?.getSettings(),
      hasRemoteViewSubscriber: this.hasRemoteTerminalViewSubscriber(ptyId)
    })
  }

  /** True when this PTY's queries go unanswered unless its single receiving remote view answers them. */
  isSoleRemoteTerminalQueryOwner(ptyId: string): boolean {
    return (
      this.terminalViewSubscribers.remoteAnsweringQueriesCount(ptyId) === 1 &&
      shouldModelAnswerHiddenPtyQueries({
        ptyId,
        settings: this.store?.getSettings(),
        hasRemoteViewSubscriber: false
      })
    )
  }

  /** Answer stateless queries a sole remote view owned at ingestion but will never receive. */
  answerYieldedTerminalQueries(ptyId: string, statelessQueryData: string): void {
    const state = this.headlessTerminals.get(ptyId)
    if (!state) {
      return
    }
    state.writeChain = state.writeChain
      .then(async () => {
        // Why drop, not retry: injecting mid-escape corrupts live parsing, and a deferred reply risks arriving after the query timed out.
        if (state.emulator.partialEscapeTailAnsi === '') {
          await state.emulator.write(statelessQueryData, { forwardQueryReplies: true })
        }
      })
      .catch(() => {})
  }

  protected trackHeadlessTerminalData(
    ptyId: string,
    data: string,
    outputSequence: number,
    forwardQueryReplies = false,
    rawLength = data.length,
    transformed = false
  ): Promise<void> {
    const state = this.getOrCreateHeadlessTerminal(ptyId)
    const outputObservedAt = Date.now()
    const completion = state.writeChain.then(async () => {
      // Capture reply ownership at ingestion, then scan inside the chain so live bytes and seeds retain total order.
      let liveData = data
      if (state.rendererSeedSeq !== undefined) {
        const uncovered = getOutputAfterSnapshotSeq(
          { data, bytes: 0, meta: { seq: outputSequence, rawLength, transformed } },
          state.rendererSeedSeq
        )
        const skipped = uncovered ? data.slice(0, data.length - uncovered.data.length) : data
        state.rendererSeedEscapeTail = advancePartialEscapeTail(
          state.rendererSeedEscapeTail ?? '',
          skipped
        )
        if (!uncovered) {
          state.outputSequence = Math.max(state.outputSequence, outputSequence)
          return
        }
        liveData = uncovered.data
        const escapeTail = state.rendererSeedEscapeTail
        state.rendererSeedSeq = undefined
        state.rendererSeedEscapeTail = undefined
        if (escapeTail) {
          state.ownership.scan(escapeTail)
          await state.emulator.write(escapeTail)
        }
      }
      state.ownership.scan(liveData)
      for (const chunk of splitFreebuffScreenUpdates(
        liveData,
        state.emulator.partialEscapeTailAnsi
      )) {
        await state.emulator.write(chunk, { forwardQueryReplies })
        const pty = this.ptysById.get(ptyId)
        if (!pty || this.headlessTerminals.get(ptyId) !== state) {
          continue
        }
        const command = this.terminalSpawnCommandsByPtyId.get(ptyId)
        const readStatus = () => this.readPtyAgentStatusRow(ptyId, pty)
        // Remote hosts report status themselves, but only this runtime can settle its own dispatches.
        if (
          observeCodexReconnectFailure(state.emulator, chunk, command, pty.launchAgent, readStatus)
        ) {
          this.settleLostAgentSession(ptyId)
        }
        if (!pty.connectionId) {
          this.trustDialogStatus.observe(ptyId, state.emulator, chunk)
          const payload =
            observeCodexCapacityTerminalStatus(
              state.emulator,
              chunk,
              command,
              pty.launchAgent,
              readStatus,
              outputObservedAt
            ) ?? observeFreebuffTerminalStatus(state.emulator, chunk, command, pty.launchAgent)
          if (payload) {
            pty.lastExplicitAgentStatus = {
              state: payload.state,
              updatedAt: Date.now(),
              sessionBoundary: payload.sessionBoundary
            }
            this.emitTerminalAgentStatusEvents(ptyId, {
              cleanData: '',
              payloads: [payload],
              lastPayloadCleanOffset: null
            })
          }
        }
      }
      state.outputSequence = outputSequence
    })
    state.writeChain = completion.catch(() => {})
    // Agency: the completion lets the capacity observer read the model only after this chunk lands.
    return completion
  }

  private readPtyAgentStatusRow(
    ptyId: string,
    pty: RuntimePtyWorktreeRecord
  ): AgentStatusIpcPayload | undefined {
    const paneKey =
      this.getLeavesForPty(ptyId).map((leaf) => this.makeRuntimePaneKey(leaf))[0] ??
      this.paneOfPty(pty).paneKey
    return paneKey ? this.getAgentStatusSnapshotForPaneFn?.(paneKey)[0] : undefined
  }
}
