/* eslint-disable max-lines -- Why: Foreground PTY agent handling keeps ownership recognition, wait probes, and transition decisions in one runtime flow. */
import { recognizeAgentProcess } from '../../shared/agent-process-recognition'
import type { LocalPtyAgentOwnerObservation } from './local-pty-agent-owner-observation'
import type { TerminalAgent } from '../../shared/terminal-agent'
import { withTimeoutResult } from './runtime-async-boundaries'
import { TERMINAL_INTERACTIVE_WAIT_PROBE_TIMEOUT_MS } from './orca-runtime-core'
import type { RuntimePtyController } from './runtime-pty-controller-contract'
import type {
  PtyForegroundAgentRefresh,
  PtyForegroundProcessRead,
  PtyForegroundProcessReadEntry
} from './runtime-terminal-contracts'
import type { RuntimePtyWorktreeRecord } from './runtime-terminal-state-records'

type Dependencies = {
  getController(): RuntimePtyController | null
  getPty(ptyId: string): RuntimePtyWorktreeRecord | null
  touchSnapshot(ptyId: string): void
  finishDelayedSnapshot(ptyId: string, changed: boolean): void
  retireLaunchOwner(ptyId: string): void
  observeLocalOwner(pty: RuntimePtyWorktreeRecord): Promise<LocalPtyAgentOwnerObservation>
}

const NATIVE_CLAUDE_VERSION_NAME = /^\d+\.\d+\.\d+$/

export class RuntimePtyForegroundAgent {
  private readonly refreshes = new Map<string, PtyForegroundAgentRefresh>()
  private readonly reads = new Map<string, PtyForegroundProcessReadEntry>()
  private readonly delayedTitles = new Map<string, number>()
  private readonly observedLaunches = new WeakMap<
    RuntimePtyWorktreeRecord,
    {
      agent: RuntimePtyWorktreeRecord['launchAgent']
      token: string | null
      incarnation: string | null
    }
  >()
  private readonly ownerProofs = new WeakMap<
    RuntimePtyWorktreeRecord,
    {
      agent: RuntimePtyWorktreeRecord['launchAgent']
      token: string | null
      incarnation: string | null
      readAgent: RuntimePtyWorktreeRecord['foregroundAgent']
      nativeStatus: RuntimePtyWorktreeRecord['lastAgentStatus']
      observation: LocalPtyAgentOwnerObservation
    }
  >()
  private readonly identifies = new Map<string, Promise<TerminalAgent | null>>()
  // A scan's recognized agent for a version name holds while that name stays in the foreground.
  private readonly confirmedByPtyId = new Map<
    string,
    { foregroundName: string; agent: TerminalAgent }
  >()

  constructor(private readonly deps: Dependencies) {}

  read(ptyId: string, afterTitle = 0): Promise<PtyForegroundProcessRead> | null {
    const controller = this.deps.getController()
    if (!controller) {
      return null
    }
    const pending = this.reads.get(ptyId)
    if (pending?.controller === controller && pending.startedAfterTitleObservation >= afterTitle) {
      return pending.promise
    }
    if (pending?.controller === controller) {
      return pending.promise.then(
        () => this.read(ptyId, afterTitle) ?? { controller, process: null, available: false }
      )
    }
    const unavailable: PtyForegroundProcessRead = { controller, process: null, available: false }
    let processRead: Promise<string | null>
    try {
      processRead = Promise.resolve(controller.getForegroundProcess(ptyId))
    } catch {
      const entry: PtyForegroundProcessReadEntry = {
        controller,
        startedAfterTitleObservation: afterTitle,
        promise: Promise.resolve(unavailable)
      }
      entry.promise = entry.promise.finally(() => this.deleteRead(ptyId, entry))
      this.reads.set(ptyId, entry)
      return entry.promise
    }
    let entry: PtyForegroundProcessReadEntry
    const promise = processRead
      .then((process) => ({ controller, process, available: true }))
      .catch(() => unavailable)
      .finally(() => this.deleteRead(ptyId, entry))
    entry = { controller, startedAfterTitleObservation: afterTitle, promise }
    this.reads.set(ptyId, entry)
    return entry.promise
  }

  refresh(ptyId: string, afterTitle = 0): Promise<boolean> {
    const pending = this.refreshes.get(ptyId)
    if (pending) {
      pending.requestedAfterTitleObservation = Math.max(
        pending.requestedAfterTitleObservation,
        afterTitle
      )
      return pending.promise
    }
    const entry: PtyForegroundAgentRefresh = {
      promise: Promise.resolve(false),
      startedAfterTitleObservation: afterTitle,
      requestedAfterTitleObservation: afterTitle
    }
    entry.promise = (async () => {
      while (true) {
        entry.startedAfterTitleObservation = entry.requestedAfterTitleObservation
        const changed = await this.load(ptyId, entry.startedAfterTitleObservation)
        if (changed || entry.requestedAfterTitleObservation <= entry.startedAfterTitleObservation) {
          return changed
        }
      }
    })().finally(() => {
      if (this.refreshes.get(ptyId) === entry) {
        this.refreshes.delete(ptyId)
      }
    })
    this.refreshes.set(ptyId, entry)
    return entry.promise
  }

  /**
   * Null when launch, foreground, or command evidence owns the pane, or `isCandidate` declines; resolves undefined only on timeout.
   * Not stored on the pty: a dialog declined before any title would leave no title transition to clear it.
   */
  identifyUnowned(
    ptyId: string,
    isCandidate: () => boolean
  ): Promise<TerminalAgent | null | undefined> | null {
    const pty = this.deps.getPty(ptyId)
    if (
      !pty ||
      (pty.launchAgent ?? pty.foregroundAgent ?? pty.launchCommandAgent) ||
      !isCandidate()
    ) {
      return null
    }
    let pending = this.identifies.get(ptyId)
    if (!pending) {
      pending = this.identifyForeground(ptyId).finally(() => this.identifies.delete(ptyId))
      this.identifies.set(ptyId, pending)
    }
    return withTimeoutResult(pending, TERMINAL_INTERACTIVE_WAIT_PROBE_TIMEOUT_MS).then((result) =>
      result.ok ? result.value : undefined
    )
  }

  getPending(ptyId: string, afterTitle: number): Promise<boolean> | undefined {
    return this.refreshes.has(ptyId) ? this.refresh(ptyId, afterTitle) : undefined
  }

  getReads(): ReadonlyMap<string, PtyForegroundProcessReadEntry> {
    return this.reads
  }

  delaySnapshot(ptyId: string, titleAt: number, refresh: Promise<boolean>): void {
    this.delayedTitles.set(ptyId, titleAt)
    void refresh.then((changed) => {
      if (this.delayedTitles.get(ptyId) !== titleAt) {
        return
      }
      this.delayedTitles.delete(ptyId)
      this.deps.finishDelayedSnapshot(ptyId, changed)
    })
  }

  hasDelayedSnapshot(ptyId: string): boolean {
    return this.delayedTitles.has(ptyId)
  }

  forget(ptyId: string): void {
    this.delayedTitles.delete(ptyId)
    this.confirmedByPtyId.delete(ptyId)
  }

  private async load(ptyId: string, afterTitle: number): Promise<boolean> {
    const controller = this.deps.getController()
    const pty = this.deps.getPty(ptyId)
    if (!controller || !pty?.connected) {
      return false
    }
    const incarnation = pty.incarnationId
    const launchAgent = pty.launchAgent
    const launchToken = pty.launchToken
    const result = await this.read(ptyId, afterTitle)
    if (
      !result ||
      result.controller !== this.deps.getController() ||
      !result.available ||
      this.deps.getPty(ptyId) !== pty ||
      pty.incarnationId !== incarnation ||
      pty.launchAgent !== launchAgent ||
      pty.launchToken !== launchToken ||
      !pty.connected
    ) {
      return false
    }
    const readAgent = result.process ? (recognizeAgentProcess(result.process)?.agent ?? null) : null
    const nativeStatus = pty.lastAgentStatus
    const observedLaunch = this.observedLaunches.get(pty)
    const launchWasObserved =
      observedLaunch?.agent === launchAgent &&
      observedLaunch?.token === launchToken &&
      observedLaunch?.incarnation === incarnation
    const previousProof = this.ownerProofs.get(pty)
    const reusableProof =
      previousProof?.agent === launchAgent &&
      previousProof.token === launchToken &&
      previousProof.incarnation === incarnation &&
      previousProof.readAgent === readAgent &&
      previousProof.nativeStatus === nativeStatus &&
      previousProof.observation.available
    if (!reusableProof) {
      this.ownerProofs.delete(pty)
    }
    const needsOwnerProof = pty.launchAgent
      ? readAgent !== pty.launchAgent || !launchWasObserved
      : readAgent !== pty.foregroundAgent
    const localOwner: LocalPtyAgentOwnerObservation =
      reusableProof && (!launchAgent || launchWasObserved)
        ? previousProof.observation
        : needsOwnerProof
          ? await this.deps.observeLocalOwner(pty)
          : { available: false }
    if (
      this.deps.getPty(ptyId) !== pty ||
      pty.incarnationId !== incarnation ||
      pty.launchAgent !== launchAgent ||
      pty.launchToken !== launchToken ||
      pty.lastAgentStatus !== nativeStatus ||
      this.deps.getController() !== controller ||
      !pty.connected
    ) {
      return false
    }
    if (needsOwnerProof && localOwner.available) {
      this.ownerProofs.set(pty, {
        agent: launchAgent,
        token: launchToken,
        incarnation,
        readAgent,
        nativeStatus,
        observation: localOwner
      })
    }
    if (pty.launchAgent && localOwner.launchPresent) {
      this.observedLaunches.set(pty, { agent: launchAgent, token: launchToken, incarnation })
    }
    if (pty.launchAgent) {
      // A complete local inventory distinguishes the parent from its nested tools.
      if (readAgent !== pty.launchAgent) {
        if (
          !localOwner.available ||
          localOwner.launchPresent ||
          (pty.launchToken && !launchWasObserved && !localOwner.agent)
        ) {
          return false
        }
        if (!localOwner.agent && !(await controller.confirmShellForeground?.(ptyId))) {
          return false
        }
        if (
          this.deps.getPty(ptyId) !== pty ||
          pty.incarnationId !== incarnation ||
          pty.launchAgent !== launchAgent ||
          pty.launchToken !== launchToken ||
          pty.lastAgentStatus !== nativeStatus ||
          this.deps.getController() !== controller ||
          !pty.connected
        ) {
          return false
        }
        this.deps.retireLaunchOwner(ptyId)
      }
    }
    // An ambiguous or unreadable local lineage cannot transfer an existing owner.
    const agent = localOwner.available
      ? localOwner.agent
      : needsOwnerProof && localOwner.local && pty.foregroundAgent
        ? pty.foregroundAgent
        : readAgent
    if (pty.foregroundAgent === agent) {
      return false
    }
    pty.foregroundAgent = agent
    this.deps.touchSnapshot(ptyId)
    return true
  }

  /** The agent now in the PTY's foreground, whoever launched it. */
  async identifyForeground(ptyId: string): Promise<TerminalAgent | null> {
    const controller = this.deps.getController()
    const pty = this.deps.getPty(ptyId)
    if (!controller || !pty?.connected) {
      return null
    }
    const result = await this.read(ptyId)
    if (!result || result.controller !== this.deps.getController() || !result.available) {
      return null
    }
    const foregroundName = result.process
    const agent = recognizeAgentProcess(foregroundName)?.agent ?? null
    // Native Claude's p_comm is its versions/<semver> binary; only a process-table scan reads its argv.
    if (agent || !foregroundName || !NATIVE_CLAUDE_VERSION_NAME.test(foregroundName)) {
      this.confirmedByPtyId.delete(ptyId)
      return agent
    }
    const confirmed = this.confirmedByPtyId.get(ptyId)
    if (confirmed?.foregroundName === foregroundName) {
      return confirmed.agent
    }
    // Windows native Claude is claude.exe (recognized by name), and confirm there forces a full scan.
    if (process.platform === 'win32') {
      return null
    }
    const confirmedAgent =
      recognizeAgentProcess(await this.confirm(result.controller, ptyId))?.agent ?? null
    if (result.controller !== this.deps.getController()) {
      return null
    }
    // Only a recognized agent is kept, so a "not an agent" verdict is rescanned on the next dialog.
    if (confirmedAgent) {
      this.confirmedByPtyId.set(ptyId, { foregroundName, agent: confirmedAgent })
    }
    return confirmedAgent
  }

  private async confirm(controller: RuntimePtyController, ptyId: string): Promise<string | null> {
    try {
      return (await controller.confirmForegroundProcess?.(ptyId)) ?? null
    } catch {
      return null
    }
  }

  private deleteRead(ptyId: string, entry: PtyForegroundProcessReadEntry): void {
    if (this.reads.get(ptyId) === entry) {
      this.reads.delete(ptyId)
    }
  }
}
