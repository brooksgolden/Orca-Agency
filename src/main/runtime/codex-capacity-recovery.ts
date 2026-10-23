import type { AgentStatus } from '../../shared/agent-detection'
import type { RuntimeTerminalRead } from '../../shared/runtime-terminal-read'
import { ownRetainedString } from '../../shared/own-retained-string'

const CAPACITY_SENTENCE = 'Selected model is at capacity. Please try a different model.'
const RETRY_DELAYS_MS = [30_000, 60_000, 120_000] as const
const RETRY_WINDOW_MS = 15 * 60_000
const MAX_TRACKED_TERMINALS = 128

export type CodexCapacityState = {
  generation: number
  inputSequence: number
  workingSequence: number
  status: AgentStatus | null
  outputSequence: number
}

export type CodexCapacityRecoveryPort = {
  enabled(): boolean
  current(ptyId: string): CodexCapacityState | null
  canRecover(ptyId: string): boolean
  screen(ptyId: string): Promise<RuntimeTerminalRead>
  sendContinue(ptyId: string, reserveWrite: () => void): Promise<boolean>
  report(
    ptyId: string,
    outcome: 'scheduled' | 'sent' | 'held' | 'exhausted',
    attempt: number,
    reason?: string
  ): void
}

type Entry = {
  generation: number
  carry: string
  sawWorking: boolean
  lastFailureTurn: number
  attempts: number[]
  timer?: ReturnType<typeof setTimeout>
  pending: boolean
  baseline?: CodexCapacityState
  lastWorkingSequence: number
  lastInputSequence: number
}

/** A provider capacity notice must be the last content above an empty Codex composer. */
export function isCodexCapacityScreen(read: RuntimeTerminalRead): boolean {
  if (
    read.status !== 'running' ||
    read.source !== 'screen' ||
    read.composerState !== 'empty' ||
    read.draft?.trim()
  ) {
    return false
  }
  return capacityNoticeAtEnd(read.tail.join('\n'))
}

function capacityNoticeAtEnd(text: string): boolean {
  const notice =
    /(?:^|\n)\s*■\s*Selected\s+model\s+is\s+at\s+capacity\.\s+Please\s+try\s+a\s+different\s+model\./g
  const match = [...text.matchAll(notice)].at(-1)
  if (!match) {
    return false
  }
  const after = text
    .slice(match.index + match[0].length)
    .split('\n')
    .filter(
      (line) =>
        !/^\s*\d+ background terminals? running(?:\s*·\s*\/ps to view(?:\s*·\s*\/stop to close)?)?\s*$/.test(
          line
        )
    )
    .join('\n')
    .trim()
  // Screen projection usually removes the composer; old hosts may retain its placeholder/footer.
  return (
    after === '' ||
    /^(?:[›>]\s*Ask Codex to do anything\s*)?(?:GPT-[^\n]*\s*)?(?:\? for shortcuts)?$/.test(after)
  )
}

/** Event-driven: no transcript scan, interval, process spawn, or model call. */
export class CodexCapacityRecovery {
  private readonly entries = new Map<string, Entry>()

  constructor(private readonly port: CodexCapacityRecoveryPort) {}

  observe(ptyId: string, data: string): void {
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
        attempts: [],
        pending: false,
        lastWorkingSequence: state.workingSequence,
        lastInputSequence: state.inputSequence
      }
      this.entries.set(ptyId, entry)
    }
    if (
      state.workingSequence !== entry.lastWorkingSequence ||
      state.inputSequence !== entry.lastInputSequence
    ) {
      if (entry.timer) {
        clearTimeout(entry.timer)
      }
      entry.timer = undefined
      entry.pending = false
      entry.baseline = undefined
      entry.carry = ''
      entry.lastWorkingSequence = state.workingSequence
      entry.lastInputSequence = state.inputSequence
    }
    if (state.status === 'working') {
      entry.sawWorking = true
    }
    const text = entry.carry + data
    entry.carry = ownRetainedString(text.slice(-512))
    if (
      !text.includes('capacity') ||
      !text.replace(/\s+/g, ' ').includes(CAPACITY_SENTENCE) ||
      !entry.sawWorking ||
      entry.pending ||
      state.workingSequence <= entry.lastFailureTurn
    ) {
      return
    }
    entry.lastFailureTurn = state.workingSequence
    entry.attempts = entry.attempts.filter((at) => Date.now() - at < RETRY_WINDOW_MS)
    const attempt = entry.attempts.length + 1
    if (attempt > RETRY_DELAYS_MS.length) {
      this.port.report(ptyId, 'exhausted', attempt - 1)
      return
    }
    entry.pending = true
    this.port.report(ptyId, 'scheduled', attempt)
    const expected = entry
    const baseline = { ...state }
    entry.baseline = baseline
    entry.timer = setTimeout(
      () => {
        entry.timer = undefined
        void this.retry(ptyId, expected, baseline, attempt)
      },
      RETRY_DELAYS_MS[attempt - 1] + Math.floor(Math.random() * 5_000)
    )
    entry.timer.unref?.()
  }

  forget(ptyId: string): void {
    const entry = this.entries.get(ptyId)
    if (entry?.timer) {
      clearTimeout(entry.timer)
    }
    this.entries.delete(ptyId)
  }

  dispose(): void {
    for (const ptyId of this.entries.keys()) {
      this.forget(ptyId)
    }
  }

  private async retry(
    ptyId: string,
    entry: Entry,
    expected: CodexCapacityState,
    attempt: number
  ): Promise<void> {
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
      if (!this.port.canRecover(ptyId)) {
        throw new Error('capacity_recovery_busy')
      }
      return current
    }
    try {
      valid()
      const before = this.port.current(ptyId)?.outputSequence
      const screen = await this.port.screen(ptyId)
      if (!isCodexCapacityScreen(screen) || valid().outputSequence !== before) {
        throw new Error('capacity_recovery_screen_changed')
      }
      // One atomic paste-and-submit frame, fenced again at the actual provider write.
      entry.attempts.push(Date.now())
      const sent = await this.port.sendContinue(ptyId, () => {
        if (valid().outputSequence !== before) {
          throw new Error('capacity_recovery_screen_changed')
        }
      })
      this.port.report(ptyId, sent ? 'sent' : 'held', attempt)
    } catch (error) {
      const reason =
        error instanceof Error && error.message.startsWith('capacity_recovery_')
          ? error.message
          : 'preflight_failed'
      this.port.report(ptyId, 'held', attempt, reason)
    } finally {
      if (entry.baseline === expected) {
        entry.pending = false
        entry.baseline = undefined
        entry.carry = ''
      }
    }
  }
}
