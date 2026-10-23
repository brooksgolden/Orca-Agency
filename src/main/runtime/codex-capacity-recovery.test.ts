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
import { canRecoverCodexCapacity } from './runtime-codex-capacity-recovery'

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
  const send = vi.fn(async (_ptyId: string, reserve: () => void) => {
    reserve()
    return true
  })
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
  it('continues after captured helper completions and the narrow stalled-goal footer', async () => {
    // Captured with terminal read --screen on 2026-10-23, matching Brooks's mobile report.
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
      return true
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
