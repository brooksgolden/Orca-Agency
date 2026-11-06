import { ownRetainedString } from '../../shared/own-retained-string'
import { CodexCapacityGoal, capacityGoalState } from './codex-capacity-goal'
import { isCodexCapacityDraftScreen, isCodexCapacityScreen } from './codex-capacity-screen'
import type { CodexCapacityRecoveryPort, CodexCapacityState } from './codex-capacity-recovery-types'
import {
  detectCodexCapacityFailure,
  type CodexCapacityFailureKind
} from './codex-capacity-stream-failure'
import type { CodexCapacityRecoveryEntry as Entry } from './codex-capacity-recovery-entry'
export { isCodexCapacityScreen } from './codex-capacity-screen'
export type { CodexCapacityRecoveryPort, CodexCapacityState } from './codex-capacity-recovery-types'

const RETRY_DELAYS_MS = [30_000, 60_000, 120_000] as const
const RETRY_WINDOW_MS = 15 * 60_000
const PREFLIGHT_RECHECK_MS = 15_000
const MAX_TRACKED_TERMINALS = 128

export class CodexCapacityRecovery {
  private readonly entries = new Map<string, Entry>()

  constructor(private readonly port: CodexCapacityRecoveryPort) {}

  observe(ptyId: string, data: string): ((footer: string[]) => void) | undefined {
    if (!this.port.enabled()) {
      this.dispose()
      return
    }
    const state = this.port.current(ptyId)
    if (!state) {
      this.forget(ptyId)
      return
    }
    let entry = this.entries.get(ptyId)
    if (entry?.generation !== state.generation) {
      this.forget(ptyId)
      if (this.entries.size >= MAX_TRACKED_TERMINALS) {
        return
      }
      entry = {
        generation: state.generation,
        carry: '',
        sawWorking: false,
        lastFailureTurn: -1,
        priorFailureTurn: -1,
        awaitingFreshOutput: false,
        handledFailureTurn: -1,
        attempts: [],
        pending: false,
        lastWorkingSequence: state.workingSequence,
        lastInputSequence: state.inputSequence,
        goal: new CodexCapacityGoal(),
        attemptRecorded: false
      }
      this.entries.set(ptyId, entry)
    }
    if (
      state.workingSequence !== entry.lastWorkingSequence ||
      state.inputSequence !== entry.lastInputSequence
    ) {
      if (entry.pending) {
        this.port.report(
          ptyId,
          'cancelled',
          entry.attempts.length + 1,
          state.inputSequence !== entry.lastInputSequence
            ? 'capacity_recovery_input_changed'
            : 'capacity_recovery_turn_changed'
        )
      }
      clearTimeout(entry.timer)
      entry.timer = undefined
      entry.pending = false
      entry.baseline = undefined
      entry.carry = ''
      entry.parkedCommand = undefined
      entry.pendingStartedAt = undefined
      entry.attemptRecorded = false
      if (state.workingSequence !== entry.lastWorkingSequence) {
        // A new turn is new work, so its first failure is not a repaint of the old error.
        entry.awaitingFreshOutput = false
        entry.handledFailureTurn = -1
      }
      entry.lastWorkingSequence = state.workingSequence
      entry.lastInputSequence = state.inputSequence
    }
    entry.sawWorking ||= state.status === 'working'
    const text = entry.carry + data
    const failureKind = detectCodexCapacityFailure(text)
    const hasFailure = failureKind !== undefined
    entry.carry = ownRetainedString(text.slice(-512))
    entry.carry = hasFailure && entry.awaitingFreshOutput ? '' : entry.carry
    if (
      !hasFailure ||
      !entry.sawWorking ||
      entry.pending ||
      entry.awaitingFreshOutput ||
      entry.handledFailureTurn === state.workingSequence ||
      state.workingSequence <= entry.lastFailureTurn
    ) {
      if (!entry.pending && !hasFailure && state.status === 'working') {
        const observedEntry = entry
        const expected = { ...state }
        return (footer) => {
          const current = this.port.current(ptyId)
          if (
            this.entries.get(ptyId) === observedEntry &&
            (!observedEntry.pending ||
              (observedEntry.baseline !== undefined &&
                expected.outputSequence < observedEntry.baseline.outputSequence)) &&
            current?.generation === expected.generation &&
            current.inputSequence === expected.inputSequence &&
            current.workingSequence === expected.workingSequence
          ) {
            observedEntry.goal.observe(footer, expected)
          }
        }
      }
      return
    }
    entry.priorFailureTurn = entry.lastFailureTurn
    entry.lastFailureTurn = state.workingSequence
    entry.attempts = entry.attempts.filter((at) => Date.now() - at < RETRY_WINDOW_MS)
    const attempt = entry.attempts.length + 1
    if (attempt > RETRY_DELAYS_MS.length) {
      this.port.report(ptyId, 'exhausted', attempt - 1)
      return
    }
    entry.pending = true
    const reportReason = failureKind === 'bad-request' ? 'bad_request' : undefined
    this.port.report(ptyId, 'scheduled', attempt, reportReason)
    const expected = entry
    const baseline = { ...state }
    entry.baseline = baseline
    entry.pendingStartedAt = Date.now()
    entry.attemptRecorded = false
    entry.timer = setTimeout(
      () => {
        entry.timer = undefined
        void this.retry(ptyId, expected, baseline, attempt, failureKind!)
      },
      RETRY_DELAYS_MS[attempt - 1] + Math.floor(Math.random() * 5_000)
    )
    return void entry.timer.unref?.()
  }

  forget(ptyId: string): void {
    const entry = this.entries.get(ptyId)
    clearTimeout(entry?.timer)
    this.entries.delete(ptyId)
  }

  dispose(): void {
    this.entries.forEach((_entry, ptyId) => this.forget(ptyId))
  }

  private async retry(
    ptyId: string,
    entry: Entry,
    expected: CodexCapacityState,
    attempt: number,
    failureKind: CodexCapacityFailureKind = 'capacity'
  ): Promise<void> {
    let recheck = false,
      reserved = false,
      screenProven = false
    const valid = (): CodexCapacityState => {
      const current = this.port.current(ptyId)
      if (
        !this.port.enabled() ||
        this.entries.get(ptyId) !== entry ||
        entry.baseline !== expected ||
        !current
      ) {
        throw new Error('capacity_recovery_superseded')
      }
      if (current.generation !== expected.generation) {
        throw new Error('capacity_recovery_process_changed')
      }
      if (current.inputSequence !== expected.inputSequence) {
        throw new Error('capacity_recovery_input_changed')
      }
      if (current.workingSequence !== expected.workingSequence) {
        throw new Error('capacity_recovery_turn_changed')
      }
      if (current.status === 'permission') {
        throw new Error('capacity_recovery_permission')
      }
      if (!this.port.canRecover(ptyId, failureKind)) {
        throw new Error('capacity_recovery_busy')
      }
      return current
    }
    try {
      valid()
      const before = this.port.current(ptyId)?.outputSequence
      const screen = await this.port.screen(ptyId)
      const command =
        entry.parkedCommand ??
        (entry.goal.wasActive(expected) && capacityGoalState(screen) === 'stalled'
          ? '/goal resume'
          : 'Continue')
      const submitExistingDraft = entry.parkedCommand === command
      const failureScreen = submitExistingDraft
        ? isCodexCapacityDraftScreen(screen, failureKind, command)
        : isCodexCapacityScreen(screen, failureKind)
      if (!failureScreen || valid().outputSequence !== before) {
        throw new Error('capacity_recovery_screen_changed')
      }
      screenProven = true
      let reservedPrefix = false
      const reserve = (): void => {
        const current = valid()
        if (!reservedPrefix && current.outputSequence !== before) {
          throw new Error('capacity_recovery_screen_changed')
        }
        if (!entry.attemptRecorded) {
          entry.attempts.push(Date.now())
          entry.attemptRecorded = true
        }
        expected.inputSequence++
        entry.lastInputSequence = expected.inputSequence
        reservedPrefix = true
        reserved = true
      }
      const delivery = submitExistingDraft
        ? await this.port.sendContinue(ptyId, reserve, command, true)
        : await this.port.sendContinue(ptyId, reserve, command)
      if (
        !delivery.sent &&
        reserved &&
        delivery.reason === 'capacity_recovery_goal_composer_unverified'
      ) {
        entry.parkedCommand = command
      } else if (delivery.sent) {
        entry.parkedCommand = undefined
      }
      if (delivery.sent && entry.baseline === expected) {
        // The accepted command is new output. The same error text may still be on screen
        // while the spinner lives on, so re-arm the turn but wait for fresh output first.
        entry.lastFailureTurn = entry.priorFailureTurn
        entry.awaitingFreshOutput = true
        entry.handledFailureTurn = expected.workingSequence
      }
      if (!delivery.sent && delivery.reason?.startsWith('capacity_recovery_')) {
        throw new Error(delivery.reason)
      }
      if (failureKind === 'bad-request') {
        this.port.report(ptyId, delivery.sent ? 'sent' : 'held', attempt, 'bad_request')
      } else {
        this.port.report(ptyId, delivery.sent ? 'sent' : 'held', attempt, delivery.reason)
      }
    } catch (error) {
      const reason =
        error instanceof Error && error.message.startsWith('capacity_recovery_')
          ? error.message
          : 'preflight_failed'
      this.port.report(ptyId, 'held', attempt, reason)
      recheck =
        reason === 'capacity_recovery_goal_composer_unverified' ||
        (!reserved &&
          (reason === 'capacity_recovery_busy' ||
            reason === 'capacity_recovery_screen_changed' ||
            reason === 'capacity_recovery_goal_composer_unverified'))
    } finally {
      if (entry.baseline === expected) {
        const insideRetryWindow =
          entry.pendingStartedAt !== undefined &&
          Date.now() - entry.pendingStartedAt < RETRY_WINDOW_MS
        if (recheck && insideRetryWindow) {
          entry.timer = setTimeout(() => {
            entry.timer = undefined
            void this.retry(ptyId, entry, expected, attempt, failureKind)
          }, PREFLIGHT_RECHECK_MS)
          entry.timer.unref?.()
        } else {
          if (recheck) {
            this.port.report(ptyId, 'exhausted', attempt, 'capacity_recovery_preflight_exhausted')
          }
          if (!screenProven) {
            // Nothing confirmed the error, so a later real failure in this turn may still schedule.
            entry.lastFailureTurn = entry.priorFailureTurn
            entry.awaitingFreshOutput = true
          }
          entry.pending = false
          entry.baseline = undefined
          entry.carry = ''
          entry.parkedCommand = undefined
          entry.pendingStartedAt = undefined
          entry.attemptRecorded = false
        }
      }
    }
  }
}
