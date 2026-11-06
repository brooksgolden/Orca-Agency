import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CodexCapacityRecovery,
  isCodexCapacityScreen,
  type CodexCapacityState
} from './codex-capacity-recovery'
import type { RuntimeTerminalRead } from '../../shared/runtime-terminal-read'
import { TerminalRunFactsRegister } from './terminal-run-facts'
import { normalizeTerminalChunk } from './terminal-ansi-normalization'
import { HeadlessEmulator } from '../daemon/headless-emulator'
import {
  canRecoverCodexCapacity,
  readCapacityRecoveryScreen
} from './runtime-codex-capacity-recovery'
import { detectCodexCapacityFailure } from './codex-capacity-stream-failure'
import { isCodexCapacityDraftScreen } from './codex-capacity-screen'

const NOTICE = '■ Selected model is at capacity. Please try a different model.'
const screen = (): RuntimeTerminalRead => ({
  handle: 'term-test',
  status: 'running',
  source: 'screen',
  composerState: 'empty',
  tail: [NOTICE],
  truncated: false,
  nextCursor: null
})

function harness() {
  vi.useFakeTimers()
  vi.spyOn(Math, 'random').mockReturnValue(0)
  let state: CodexCapacityState | null = {
    generation: 1,
    inputSequence: 1,
    workingSequence: 1,
    status: 'working',
    outputSequence: 1
  }
  let enabled = true
  const read = vi.fn(async () => screen())
  const send = vi.fn(
    async (_ptyId: string, reserve: () => void, _command: 'Continue' | '/goal resume') => {
      reserve()
      return { sent: true }
    }
  )
  const report = vi.fn()
  const idle = vi.fn(() => state?.status === 'idle')
  const recovery = new CodexCapacityRecovery({
    enabled: () => enabled,
    current: () => state,
    screen: read,
    sendContinue: send,
    report,
    canRecover: idle
  })
  const observeFailure = () => {
    if (!state) {
      throw new Error('missing test process')
    }
    state.status = 'working'
    recovery.observe('pty', 'working')
    state.status = 'idle'
    recovery.observe('pty', NOTICE)
  }
  return {
    recovery,
    send,
    read,
    report,
    idle,
    observeFailure,
    state: () => state!,
    replace: (next: CodexCapacityState | null) => {
      state = next
    },
    disable: () => {
      enabled = false
    }
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('Codex capacity recovery', () => {
  it('retries an exact Bad Request after a working turn', async () => {
    const h = harness()
    h.recovery.observe('pty', 'working')
    h.state().status = 'idle'
    const bad = '\u25a0 {"detail":"Bad Request"}'
    h.read.mockResolvedValue({ ...screen(), tail: [bad] })
    h.recovery.observe('pty', bad)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(h.send).toHaveBeenCalledWith('pty', expect.any(Function), 'Continue')
    expect(h.report).toHaveBeenCalledWith('pty', 'sent', 1, 'bad_request')
  })
  it('detects a Bad Request split across terminal output chunks', async () => {
    const h = harness()
    h.recovery.observe('pty', 'working')
    h.state().status = 'idle'
    const bad = '\u25a0 {"detail":"Bad Request"}'
    h.read.mockResolvedValue({ ...screen(), tail: [bad] })
    h.recovery.observe('pty', '\u25a0 {"detail":"Bad')
    h.recovery.observe('pty', ' Request"}')
    await vi.advanceTimersByTimeAsync(30_000)
    expect(h.send).toHaveBeenCalledTimes(1)
  })
  it('detects the exact captured 54-column ConPTY capacity notice', () => {
    const raw = Buffer.from(
      readFileSync(
        join(import.meta.dirname, '__fixtures__', 'codex-capacity-narrow-54col.raw.base64'),
        'utf8'
      ).trim(),
      'base64'
    ).toString('utf8')
    expect(detectCodexCapacityFailure(raw)).toBe('capacity')
  })
  it('detects a Bad Request split by erase-line CSI at its word boundary', () => {
    expect(detectCodexCapacityFailure('{"detail":"Bad\x1b[K\r\n Request"}')).toBe('bad-request')
  })
  it('recovers an exact Bad Request after the rendered JSON wraps within a word', async () => {
    const h = harness()
    const bad = '\u25a0 {"detail":"Bad Request"}'
    const emulator = new HeadlessEmulator({ cols: 16, rows: 8 })
    try {
      await emulator.write(bad)
      h.recovery.observe('pty', 'working')
      h.state().status = 'idle'
      h.read.mockResolvedValue({ ...screen(), tail: emulator.getVisibleLines() })
      h.recovery.observe('pty', bad)
      await vi.advanceTimersByTimeAsync(30_000)
      expect(h.send).toHaveBeenCalledWith('pty', expect.any(Function), 'Continue')
    } finally {
      emulator.dispose()
    }
  })
  it('resumes a previously active goal after the exact Bad Request', async () => {
    const h = harness()
    const active = 'GPT-6 Pursuing goal (4m)'
    h.recovery.observe('pty', active)?.([active])
    h.state().status = 'idle'
    const bad = '\u25a0 {"detail":"Bad Request"}'
    h.read.mockResolvedValue({ ...screen(), tail: [bad, 'GPT-6 Goal stalled (/goal resume)'] })
    h.recovery.observe('pty', bad)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(h.send).toHaveBeenCalledWith('pty', expect.any(Function), '/goal resume')
  })
  it('does not resume a goal that was already paused before Bad Request', async () => {
    const h = harness()
    const paused = 'GPT-6 Goal paused (/goal resume)'
    h.recovery.observe('pty', paused)?.([paused])
    h.state().status = 'idle'
    const bad = '\u25a0 {"detail":"Bad Request"}'
    h.read.mockResolvedValue({ ...screen(), tail: [bad, 'GPT-6 Goal stalled (/goal resume)'] })
    h.recovery.observe('pty', bad)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(h.send).toHaveBeenCalledWith('pty', expect.any(Function), 'Continue')
  })
  it('does not overwrite user input after a Bad Request', async () => {
    const h = harness()
    h.recovery.observe('pty', 'working')
    h.state().status = 'idle'
    const bad = '\u25a0 {"detail":"Bad Request"}'
    h.read.mockResolvedValue({ ...screen(), tail: [bad] })
    h.recovery.observe('pty', bad)
    h.state().inputSequence++
    await vi.advanceTimersByTimeAsync(30_000)
    expect(h.send).not.toHaveBeenCalled()
  })
  it('limits repeated Bad Request retries to three', async () => {
    const h = harness()
    const bad = '\u25a0 {"detail":"Bad Request"}'
    h.read.mockResolvedValue({ ...screen(), tail: [bad] })
    for (const delay of [30_000, 60_000, 120_000]) {
      h.state().status = 'working'
      h.recovery.observe('pty', 'working')
      h.state().status = 'idle'
      h.recovery.observe('pty', bad)
      await vi.advanceTimersByTimeAsync(delay)
      h.state().workingSequence++
    }
    h.state().status = 'working'
    h.recovery.observe('pty', 'working')
    h.state().status = 'idle'
    h.recovery.observe('pty', bad)
    await vi.advanceTimersByTimeAsync(300_000)
    expect(h.send).toHaveBeenCalledTimes(3)
    expect(h.report).toHaveBeenLastCalledWith('pty', 'exhausted', 3)
  })
  it('does not submit when the Bad Request belongs to an older screen', async () => {
    const h = harness()
    h.recovery.observe('pty', 'working')
    h.state().status = 'idle'
    h.read.mockResolvedValue(screen())
    h.recovery.observe('pty', '\u25a0 {"detail":"Bad Request"}')
    await vi.advanceTimersByTimeAsync(30_000)
    expect(h.send).not.toHaveBeenCalled()
  })

  it('preserves prior active-goal evidence across a transient check', async () => {
    const h = harness()
    const active = 'GP… Pursuing goal (4m)    ⚠ 2 warnings · f2 to view'
    h.recovery.observe('pty', active)?.([active])
    h.read.mockResolvedValueOnce({ ...screen(), composerState: 'unknown' })
    h.observeFailure()
    h.read.mockResolvedValue({ ...screen(), tail: [NOTICE, 'G… Goal stalled (/goal resume)'] })
    await vi.advanceTimersByTimeAsync(90_000)
    expect(h.send).toHaveBeenCalledWith('pty', expect.any(Function), '/goal resume')
  })
  it('rechecks after a real emulator resize reflow until Codex repaints', async () => {
    const h = harness()
    const text = readFileSync(
      join(import.meta.dirname, '__fixtures__', 'codex-capacity-recap-screen.txt'),
      'utf8'
    )
    const emulator = new HeadlessEmulator({ cols: 100, rows: 40 })
    try {
      await emulator.write(text.replace(/\n/g, '\r\n'))
      emulator.resize(40, 40)
      h.read.mockResolvedValue({
        ...screen(),
        tail: emulator.getVisibleLines().filter((line) => line.trim())
      })
      h.observeFailure()
      await vi.advanceTimersByTimeAsync(30_000)
      expect(h.send).not.toHaveBeenCalled()
      emulator.resize(100, 40)
      await emulator.write(`\x1b[H\x1b[2J${text.replace(/\n/g, '\r\n')}`)
      h.read.mockResolvedValue({
        ...screen(),
        tail: emulator.getVisibleLines().filter((line) => line.trim())
      })
      await vi.advanceTimersByTimeAsync(60_000)
      expect(h.send).toHaveBeenCalledTimes(1)
    } finally {
      emulator.dispose()
    }
  })
  it.each(['unknown composer', 'busy', 'moving output'] as const)(
    'rechecks a transient %s without another provider error',
    async (reason) => {
      const h = harness()
      if (reason === 'busy') {
        h.idle.mockReturnValueOnce(false)
      } else {
        h.read.mockImplementationOnce(async () => {
          if (reason === 'moving output') {
            h.state().outputSequence++
          }
          return { ...screen(), composerState: reason === 'unknown composer' ? 'unknown' : 'empty' }
        })
      }
      h.observeFailure()
      await vi.advanceTimersByTimeAsync(30_000)
      expect(h.send).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(60_000)
      expect(h.send).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(900_000)
      expect(h.send).toHaveBeenCalledTimes(1)
    }
  )
  it.each(['inputSequence', 'workingSequence', 'generation', 'permission'] as const)(
    'does not recheck past an intervening %s',
    async (change) => {
      const h = harness()
      h.read.mockResolvedValueOnce({ ...screen(), composerState: 'unknown' })
      h.observeFailure()
      await vi.advanceTimersByTimeAsync(30_000)
      if (change === 'permission') {
        h.state().status = 'permission'
      } else {
        h.state()[change]++
      }
      await vi.advanceTimersByTimeAsync(900_000)
      expect(h.send).not.toHaveBeenCalled()
      expect(h.read).toHaveBeenCalledTimes(1)
    }
  )
  it('bounds transient checks and reports exhaustion once', async () => {
    const h = harness()
    h.read.mockResolvedValue({ ...screen(), composerState: 'unknown' })
    h.observeFailure()
    await vi.advanceTimersByTimeAsync(900_000)
    expect(h.read.mock.calls.length).toBeGreaterThan(3)
    expect(h.read.mock.calls.length).toBeLessThanOrEqual(60)
    expect(h.send).not.toHaveBeenCalled()
    expect(h.report.mock.calls.filter((call) => call[1] === 'exhausted')).toHaveLength(1)
  })
  it('reports a new turn cancelling the parked retry', () => {
    const h = harness()
    h.observeFailure()
    h.state().workingSequence++
    h.recovery.observe('pty', 'new turn')
    expect(h.report).toHaveBeenLastCalledWith(
      'pty',
      'cancelled',
      1,
      'capacity_recovery_turn_changed'
    )
  })
  it.each(['active', 'stalled', 'paused', 'unknown'] as const)(
    'resumes only a goal observed active before the failure: %s',
    async (before) => {
      const h = harness()
      const active = readFileSync(
        join(import.meta.dirname, '__fixtures__', 'codex-pursuing-goal-screen.txt'),
        'utf8'
      )
      const footer =
        before === 'active'
          ? active
          : before === 'unknown'
            ? 'ordinary text'
            : `G… Goal ${before} (/goal resume)    ⚠ 2 warnings · f2 to view`
      h.read.mockResolvedValue({ ...screen(), tail: footer.trimEnd().split('\n') })
      h.recovery.observe('pty', footer)?.(footer.trimEnd().split('\n'))
      await vi.advanceTimersByTimeAsync(0)
      h.read.mockResolvedValue({
        ...screen(),
        tail: readFileSync(
          join(import.meta.dirname, '__fixtures__', 'codex-capacity-recap-screen.txt'),
          'utf8'
        )
          .trimEnd()
          .split('\n')
      })
      h.observeFailure()
      await vi.advanceTimersByTimeAsync(30_000)
      expect(h.send).toHaveBeenCalledWith(
        'pty',
        expect.any(Function),
        before === 'active' ? '/goal resume' : 'Continue'
      )
    }
  )
  it('cancels automatic goal resumption after a manual resume or input', async () => {
    const h = harness()
    const active = 'GP… Pursuing goal (4m)    ⚠ 2 warnings · f2 to view'
    h.read.mockResolvedValue({ ...screen(), tail: [active] })
    h.recovery.observe('pty', active)?.([active])
    await vi.advanceTimersByTimeAsync(0)
    h.read.mockResolvedValue({
      ...screen(),
      tail: [NOTICE, 'G… Goal stalled (/goal resume)    ⚠ 3 warnings · f2 to view']
    })
    h.observeFailure()
    h.state().inputSequence++
    await vi.advanceTimersByTimeAsync(30_000)
    expect(h.send).not.toHaveBeenCalled()
  })
  it.each(['G…', 'GP…', 'GPT-6.1-So…'])(
    'preserves a previously paused goal with a narrow model footer: %s',
    async (model) => {
      const h = harness()
      h.read.mockResolvedValue({
        ...screen(),
        tail: [NOTICE, `${model} Goal paused (/goal resume)    ⚠ 3 warnings · f2 to view`]
      })
      h.observeFailure()
      await vi.advanceTimersByTimeAsync(30_000)
      expect(h.send).toHaveBeenCalledWith('pty', expect.any(Function), 'Continue')
    }
  )
  it('continues after captured helper completions and the narrow stalled-goal footer', async () => {
    // Captured with terminal read --screen on 2026-10-23, matching Example User's mobile report.
    const tail = readFileSync(
      join(import.meta.dirname, '__fixtures__', 'codex-capacity-completed-screen.txt'),
      'utf8'
    )
      .trimEnd()
      .split('\n')
    const h = harness()
    h.read.mockResolvedValue({ ...screen(), tail })
    h.observeFailure()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(h.send).toHaveBeenCalledTimes(1)
  })
  it.each([
    '• Completed `/root/helper` Do you approve?',
    '• Completed deployment. Continue?',
    '• Completed `/root/helper`\nWhich account should I use?',
    '• Completed `/root/helper`\n› my unsent message',
    'G… Goal stalled (/goal resume)    Choose an option'
  ])('rejects substantive content after completion: %s', (after) => {
    expect(isCodexCapacityScreen({ ...screen(), tail: [NOTICE, after] })).toBe(false)
  })
  it('accepts the background-terminal footer after a capacity failure', () => {
    expect(
      isCodexCapacityScreen({
        ...screen(),
        tail: [NOTICE, '', '1 background terminal running · /ps to view · /stop to close']
      })
    ).toBe(true)
    expect(
      isCodexCapacityScreen({
        ...screen(),
        tail: [NOTICE, 'Do you approve continuing?', '1 background terminal running']
      })
    ).toBe(false)
  })
  it('cancels a parked retry when a new turn starts and retries its fresh failure', async () => {
    const h = harness()
    h.observeFailure()
    await vi.advanceTimersByTimeAsync(10_000)
    h.state().workingSequence++
    h.state().status = 'working'
    h.recovery.observe('pty', 'new work')
    h.state().status = 'idle'
    h.recovery.observe('pty', NOTICE)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(h.send).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(h.send).toHaveBeenCalledTimes(1)
  })
  it('respects authoritative busy or permission state despite a cached idle title', async () => {
    const h = harness()
    h.observeFailure()
    h.idle.mockReturnValue(false)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(h.send).not.toHaveBeenCalled()
  })
  it('continues once after a delay, never per repaint or old repeated text', async () => {
    const h = harness()
    h.observeFailure()
    for (let i = 0; i < 20; i++) {
      h.recovery.observe('pty', NOTICE)
    }
    await vi.advanceTimersByTimeAsync(29_999)
    expect(h.send).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(h.send).toHaveBeenCalledTimes(1)
    h.recovery.observe('pty', NOTICE)
    await vi.advanceTimersByTimeAsync(300_000)
    expect(h.send).toHaveBeenCalledTimes(1)
  })

  it('does not re-arm a handled turn after synchronized-output control bytes', async () => {
    const h = harness()
    h.observeFailure()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(h.send).toHaveBeenCalledTimes(1)
    const control = normalizeTerminalChunk('\x1b[?2026h\x1b[?2026l')
    expect(control.text).toBe('')
    h.recovery.observe('pty', control.text)
    h.recovery.observe('pty', NOTICE)
    await vi.advanceTimersByTimeAsync(300_000)
    expect(h.send).toHaveBeenCalledTimes(1)
  })

  it('recognizes an error split across chunks from the captured real Codex PTY', async () => {
    const h = harness()
    h.recovery.observe('pty', 'working')
    h.state().status = 'idle'
    const raw = readFileSync(
      join(import.meta.dirname, '__fixtures__', 'codex-capacity-overload.txt'),
      'utf8'
    )
    let pendingAnsi = ''
    for (let i = 0; i < raw.length; i += 17) {
      const normalized = normalizeTerminalChunk(raw.slice(i, i + 17), pendingAnsi)
      pendingAnsi = normalized.pendingAnsi
      h.recovery.observe('pty', normalized.text)
    }
    await vi.advanceTimersByTimeAsync(30_000)
    expect(h.send).toHaveBeenCalledTimes(1)
  })

  it('recognizes a narrow wrapped notice split by retained erase-line CSI', async () => {
    const h = harness()
    h.recovery.observe('pty', 'working')
    h.state().status = 'idle'
    h.recovery.observe(
      'pty',
      '\u25a0 Selected model is at capac\x1b[K\n  ity. Please try a different model.'
    )
    await vi.advanceTimersByTimeAsync(30_000)
    expect(h.send).toHaveBeenCalledTimes(1)
  })

  it('recognizes the exact captured 44-column failure stream', async () => {
    const h = harness()
    const raw = Buffer.from(
      readFileSync(
        join(import.meta.dirname, '__fixtures__', 'codex-capacity-narrow-44col.raw.base64'),
        'utf8'
      ).trim(),
      'base64'
    ).toString('utf8')
    let pendingAnsi = ''
    for (let index = 0; index < raw.length; index += 29) {
      const normalized = normalizeTerminalChunk(raw.slice(index, index + 29), pendingAnsi)
      pendingAnsi = normalized.pendingAnsi
      h.recovery.observe('pty', normalized.text)
    }
    h.state().status = 'idle'
    await vi.advanceTimersByTimeAsync(30_000)
    expect(h.send).toHaveBeenCalledTimes(1)
  })

  it('reports and rechecks an unsubmitted owned draft', async () => {
    const h = harness()
    h.send.mockImplementation(async (_id, reserve) => {
      reserve()
      h.state().inputSequence++
      return { sent: false, reason: 'capacity_recovery_goal_composer_unverified' }
    })
    h.observeFailure()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(h.report).toHaveBeenCalledWith(
      'pty',
      'held',
      1,
      'capacity_recovery_goal_composer_unverified'
    )
    h.read.mockResolvedValue({
      ...screen(),
      composerState: 'draft',
      draft: 'Continue',
      tail: [NOTICE, '›', 'GPT-6.1-Sol default · fixture']
    })
    expect(isCodexCapacityDraftScreen(await h.read(), 'capacity', 'Continue')).toBe(true)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(h.send).toHaveBeenCalledTimes(2)
    expect(h.send).toHaveBeenLastCalledWith('pty', expect.any(Function), 'Continue', true)
  })

  it.each(['draft', 'unknown'] as const)('holds when composer is %s', async (composerState) => {
    const h = harness()
    h.read.mockResolvedValue({ ...screen(), composerState })
    h.observeFailure()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(h.send).not.toHaveBeenCalled()
  })

  it.each(['working', 'permission'] as const)(
    'cancels when status changes to %s',
    async (status) => {
      const h = harness()
      h.observeFailure()
      h.state().status = status
      await vi.advanceTimersByTimeAsync(30_000)
      expect(h.send).not.toHaveBeenCalled()
    }
  )

  it.each(['inputSequence', 'generation', 'workingSequence'] as const)(
    'cancels changed %s',
    async (key) => {
      const h = harness()
      h.observeFailure()
      h.state()[key]++
      await vi.advanceTimersByTimeAsync(30_000)
      expect(h.send).not.toHaveBeenCalled()
    }
  )

  it('checks input again at the actual write, after asynchronous preflight', async () => {
    const h = harness()
    let wrote = false
    h.send.mockImplementation(async (_id, reserve) => {
      h.state().inputSequence++
      reserve()
      wrote = true
      return { sent: true }
    })
    h.observeFailure()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(wrote).toBe(false)
    expect(h.report).toHaveBeenLastCalledWith('pty', 'held', 1, 'capacity_recovery_input_changed')
  })

  it('holds if the screen changes during a rendered read', async () => {
    const h = harness()
    h.read.mockImplementation(async () => {
      h.state().outputSequence++
      return screen()
    })
    h.observeFailure()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(h.send).not.toHaveBeenCalled()
  })

  it('limits consecutive failures to three attempts and backs off', async () => {
    const h = harness()
    for (const delay of [30_000, 60_000, 120_000]) {
      h.observeFailure()
      await vi.advanceTimersByTimeAsync(delay - 1)
      expect(h.send).toHaveBeenCalledTimes([30_000, 60_000, 120_000].indexOf(delay))
      await vi.advanceTimersByTimeAsync(1)
      h.state().workingSequence++
    }
    h.observeFailure()
    await vi.advanceTimersByTimeAsync(300_000)
    expect(h.send).toHaveBeenCalledTimes(3)
    expect(h.report).toHaveBeenLastCalledWith('pty', 'exhausted', 3)
  })

  it('starts the retry window when a delayed retry first writes, not when it is scheduled', async () => {
    const h = harness()
    h.idle.mockReturnValue(false)
    h.observeFailure()
    await vi.advanceTimersByTimeAsync(870_000)
    h.idle.mockReturnValue(true)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(h.send).toHaveBeenCalledTimes(1)
    for (const delay of [60_000, 120_000]) {
      h.state().workingSequence++
      h.observeFailure()
      await vi.advanceTimersByTimeAsync(delay)
    }
    expect(h.send).toHaveBeenCalledTimes(3)
    h.state().workingSequence++
    h.observeFailure()
    await vi.advanceTimersByTimeAsync(300_000)
    expect(h.send).toHaveBeenCalledTimes(3)
    expect(h.report).toHaveBeenLastCalledWith('pty', 'exhausted', 3)
  })

  it('does not replay a handled failure while a stuck spinner never advances the turn', async () => {
    const h = harness()
    h.observeFailure()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(h.send).toHaveBeenCalledTimes(1)
    for (const delay of [60_000, 120_000]) {
      h.recovery.observe('pty', NOTICE)
      await vi.advanceTimersByTimeAsync(delay)
    }
    expect(h.state().workingSequence).toBe(1)
    expect(h.send).toHaveBeenCalledTimes(1)
  })

  it('restores the turn after a quoted error the screen never confirms, so a later real failure is sent', async () => {
    const h = harness()
    const quoted = `The message says: ${NOTICE}`
    h.read.mockResolvedValue({ ...screen(), tail: [quoted] })
    h.recovery.observe('pty', 'working')
    h.state().status = 'idle'
    h.recovery.observe('pty', quoted)
    await vi.advanceTimersByTimeAsync(300_000)
    const readsWhileWaiting = h.read.mock.calls.length
    expect(readsWhileWaiting).toBeGreaterThan(3)
    expect(h.send).not.toHaveBeenCalled()
    // A repaint of the same quoted text, with no new output, must not reschedule.
    h.recovery.observe('pty', quoted)
    await vi.advanceTimersByTimeAsync(300_000)
    expect(h.read.mock.calls.length).toBeGreaterThan(readsWhileWaiting)
    expect(h.report.mock.calls.filter((call) => call[1] === 'scheduled')).toHaveLength(1)
    expect(h.send).not.toHaveBeenCalled()
    h.read.mockResolvedValue(screen())
    h.observeFailure()
    await vi.advanceTimersByTimeAsync(15_000)
    expect(h.send).toHaveBeenCalledTimes(1)
  })

  it.each(['disable', 'exit'] as const)('cancels on %s', async (reason) => {
    const h = harness()
    h.observeFailure()
    if (reason === 'disable') {
      h.disable()
    } else {
      h.replace(null)
    }
    await vi.advanceTimersByTimeAsync(30_000)
    expect(h.send).not.toHaveBeenCalled()
  })

  it('does not revive a terminal from a historical idle error', async () => {
    const h = harness()
    h.state().status = 'idle'
    h.recovery.observe('pty', NOTICE)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(h.send).not.toHaveBeenCalled()
  })

  it('does not retry after disposal or process retirement', async () => {
    const h = harness()
    h.observeFailure()
    h.recovery.forget('pty')
    await vi.advanceTimersByTimeAsync(30_000)
    expect(h.send).not.toHaveBeenCalled()
  })
})

describe('capacity screen boundary', () => {
  it('blocks explicit working and permissions while allowing a stale title spinner', () => {
    expect(canRecoverCodexCapacity({ status: 'working', explicitWorkingStartedAt: 100 })).toBe(
      false
    )
    expect(canRecoverCodexCapacity({ status: 'permission', explicitWorkingStartedAt: null })).toBe(
      false
    )
    expect(canRecoverCodexCapacity({ status: 'working', explicitWorkingStartedAt: null })).toBe(
      true
    )
    expect(canRecoverCodexCapacity({ status: null, explicitWorkingStartedAt: null })).toBe(true)
    expect(
      canRecoverCodexCapacity({
        status: 'working',
        explicitWorkingStartedAt: 100,
        mainAgentState: 'done',
        mainAgentOutcome: 'failure'
      })
    ).toBe(true)
    expect(
      canRecoverCodexCapacity({
        status: 'permission',
        explicitWorkingStartedAt: null,
        mainAgentState: 'done',
        mainAgentOutcome: 'failure'
      })
    ).toBe(false)
    expect(
      canRecoverCodexCapacity(
        {
          status: 'working',
          explicitWorkingStartedAt: 100,
          mainAgentState: 'done'
        },
        'bad-request'
      )
    ).toBe(true)
  })
  it('merges only the newest failure recap before the visible short-pane composer', async () => {
    const visible: RuntimeTerminalRead = {
      ...screen(),
      tail: [
        '    final recap continuation',
        '',
        '› Ask Codex to do anything',
        'GPT-6.1-Sol default · fixture'
      ]
    }
    const history: RuntimeTerminalRead = {
      ...screen(),
      source: 'stream',
      tail: [
        'old output that must not be reconsidered',
        NOTICE,
        '↳ Recap: the interrupted work remains resumable',
        '',
        '    first recap continuation',
        '',
        '    final recap continuation',
        '› Ask Codex to do anything',
        'GPT-6.1-Sol default · fixture'
      ]
    }
    const readTerminal = vi.fn().mockResolvedValueOnce(visible).mockResolvedValueOnce(history)
    const merged = await readCapacityRecoveryScreen({ readTerminal } as never, 'term-test')
    expect(merged.tail).not.toContain('old output that must not be reconsidered')
    expect(isCodexCapacityScreen(merged)).toBe(true)
  })
  it('accepts the real error frame rendered from the captured PTY bytes', async () => {
    const emulator = new HeadlessEmulator({ cols: 120, rows: 34 })
    try {
      const raw = readFileSync(
        join(import.meta.dirname, '__fixtures__', 'codex-capacity-overload.txt'),
        'utf8'
      )
      await emulator.write(raw)
      expect(isCodexCapacityScreen({ ...screen(), tail: emulator.getVisibleLines() })).toBe(true)
    } finally {
      emulator.dispose()
    }
  })
  it('accepts the provider notice when wrapped in a narrow pane', () => {
    expect(
      isCodexCapacityScreen({
        ...screen(),
        tail: ['■ Selected model is at capacity.', 'Please try a different model.']
      })
    ).toBe(true)
  })

  it.each([
    ['exited process', { status: 'exited' as const }],
    ['source unavailable', { source: 'screen-unavailable' as const }],
    ['saved draft', { draft: 'do not lose this' }],
    ['ordinary quote', { tail: [`The message says: ${NOTICE}`] }],
    ['new question', { tail: [NOTICE, 'Which account should I use?'] }],
    ['usage limit', { tail: ['■ You have reached your usage limit.'] }],
    ['completed work', { tail: [NOTICE, 'Finished successfully.'] }]
  ])('rejects %s', (_label, change) => {
    expect(isCodexCapacityScreen({ ...screen(), ...change })).toBe(false)
  })

  it('distinguishes two inputs in the same millisecond, excluding terminal query replies', () => {
    const facts = new TerminalRunFactsRegister()
    facts.recordInput('pty', 'driving', 'first', 100)
    const first = facts.readInputSequence('pty')
    facts.recordInput('pty', 'driving', 'second', 100)
    expect(facts.readInputSequence('pty')).toBe(first + 1)
    facts.recordInput('pty', 'query-reply', '\x1b[0n', 100)
    expect(facts.readInputSequence('pty')).toBe(first + 1)
  })
})
