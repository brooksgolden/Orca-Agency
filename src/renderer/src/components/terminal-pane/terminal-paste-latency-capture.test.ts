import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TerminalPastePlan } from './terminal-paste-model'
import { captureTerminalPasteLatency } from './terminal-paste-latency-capture'

const recordBreadcrumb = vi.hoisted(() => vi.fn())
vi.mock('@/lib/crash-breadcrumb-recorder', () => ({
  recordRendererCrashBreadcrumb: recordBreadcrumb
}))

const plan: TerminalPastePlan = {
  target: {
    kind: 'terminal',
    paneId: 1,
    leafId: 'leaf',
    ptyId: 'pty',
    runtime: { platform: 'win32', runtimeKey: 'local:win32', kind: 'local' }
  },
  payload: {
    plainText: 'private clipboard contents',
    source: 'keyboard',
    byteLength: 26,
    lineCount: 1,
    hasRichText: false,
    hasControlSequences: false,
    lineEndingByteLength: 0
  },
  mode: 'direct',
  newlinePolicy: 'preserve',
  runtimeKey: 'local:win32',
  bracketed: false,
  redactedDiagnostic: 'private diagnostic'
}

function terminalFixture() {
  const listeners = new Map<string, Set<() => void>>()
  const on = (kind: string) => (listener: () => void) => {
    const set = listeners.get(kind) ?? new Set<() => void>()
    set.add(listener)
    listeners.set(kind, set)
    return { dispose: () => set.delete(listener) }
  }
  return {
    terminal: { onData: on('data'), onWriteParsed: on('parsed'), onRender: on('render') },
    emit: (kind: string) => listeners.get(kind)?.forEach((listener) => listener()),
    listenerCount: () => [...listeners.values()].reduce((count, set) => count + set.size, 0)
  }
}

describe('bounded terminal paste latency capture', () => {
  let now = 0
  const advance = (ms: number) => {
    now += ms
    vi.advanceTimersByTime(ms)
  }

  beforeEach(() => {
    now = 0
    vi.useFakeTimers()
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    recordBreadcrumb.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('ignores a fast paste and releases terminal listeners', () => {
    const { terminal, emit, listenerCount } = terminalFixture()
    const capture = captureTerminalPasteLatency(terminal, plan, {
      requestedAtMs: 0,
      clipboardReadyAtMs: 5,
      plannedAtMs: 10
    })
    expect(capture).not.toBeNull()
    advance(20)
    capture?.markDispatched()
    advance(20)
    emit('parsed')
    advance(20)
    emit('render')
    capture?.complete({ status: 'pasted', chunksWritten: 1, durationMs: 50, diagnostic: '' })
    advance(5_000)

    expect(recordBreadcrumb).not.toHaveBeenCalled()
    expect(listenerCount()).toBe(0)
  })

  it('records slow paint stages without clipboard contents or terminal identity', () => {
    const { terminal, emit, listenerCount } = terminalFixture()
    const capture = captureTerminalPasteLatency(terminal, plan, {
      requestedAtMs: 0,
      clipboardReadyAtMs: 5,
      plannedAtMs: 10
    })
    advance(30)
    capture?.markDispatched()
    advance(20)
    emit('parsed')
    advance(650)
    emit('render')
    capture?.complete({ status: 'pasted', chunksWritten: 1, durationMs: 50, diagnostic: '' })
    advance(5_000)

    expect(recordBreadcrumb).toHaveBeenCalledWith(
      'terminal_paste_slow',
      expect.objectContaining({
        attribution: 'temporal',
        source: 'keyboard',
        bytes: 26,
        dispatchDelayMs: 30,
        parseAfterDispatchMs: 20,
        firstPaintDelayMs: 700,
        lastPaintDelayMs: 700,
        parsedBatches: 1,
        renderBatches: 1
      })
    )
    expect(JSON.stringify(recordBreadcrumb.mock.calls)).not.toContain('private')
    expect(JSON.stringify(recordBreadcrumb.mock.calls)).not.toContain('pty')
    expect(listenerCount()).toBe(0)
  })

  it('does not call a fast paste slow when an agent keeps repainting afterward', () => {
    const { terminal, emit, listenerCount } = terminalFixture()
    const capture = captureTerminalPasteLatency(terminal, plan, {
      requestedAtMs: 0,
      clipboardReadyAtMs: 5,
      plannedAtMs: 10
    })
    advance(20)
    capture?.markDispatched()
    advance(20)
    emit('parsed')
    advance(20)
    emit('render')
    capture?.complete({ status: 'pasted', chunksWritten: 1, durationMs: 50, diagnostic: '' })
    for (let index = 0; index < 9; index++) {
      advance(500)
      emit('render')
    }
    advance(500)

    expect(recordBreadcrumb).not.toHaveBeenCalled()
    expect(listenerCount()).toBe(0)
  })

  it('does not attribute pre-dispatch output and paint to the paste', () => {
    const { terminal, emit } = terminalFixture()
    const capture = captureTerminalPasteLatency(terminal, plan, {
      requestedAtMs: 0,
      clipboardReadyAtMs: 5,
      plannedAtMs: 10
    })
    advance(10)
    emit('parsed')
    emit('render')
    advance(20)
    capture?.markDispatched()
    advance(20)
    emit('render')
    advance(650)
    emit('parsed')
    advance(30)
    emit('render')
    capture?.complete({ status: 'pasted', chunksWritten: 1, durationMs: 50, diagnostic: '' })
    advance(5_000)

    expect(recordBreadcrumb).toHaveBeenCalledWith(
      'terminal_paste_slow',
      expect.objectContaining({
        dispatchDelayMs: 30,
        parseAfterDispatchMs: 670,
        firstPaintDelayMs: 730,
        parsedBatches: 1,
        renderBatches: 1
      })
    )
  })

  it('measures chunked PTY writes without relying on a later onData event', () => {
    const { terminal, emit } = terminalFixture()
    const capture = captureTerminalPasteLatency(
      terminal,
      { ...plan, mode: 'chunked' },
      {
        requestedAtMs: 0,
        clipboardReadyAtMs: 5,
        plannedAtMs: 10
      }
    )
    advance(10)
    emit('parsed')
    emit('render')
    advance(20)
    emit('data')
    capture?.markDispatched()
    advance(30)
    emit('parsed')
    advance(650)
    emit('render')
    capture?.complete({ status: 'pasted', chunksWritten: 2, durationMs: 50, diagnostic: '' })
    advance(5_000)

    expect(recordBreadcrumb).toHaveBeenCalledWith(
      'terminal_paste_slow',
      expect.objectContaining({
        mode: 'chunked',
        dispatchDelayMs: 30,
        parseAfterDispatchMs: 30,
        firstPaintDelayMs: 710,
        parsedBatches: 1,
        renderBatches: 1
      })
    )
  })

  it('does not mistake a later keystroke for an unstarted chunked paste', () => {
    const { terminal, emit } = terminalFixture()
    const capture = captureTerminalPasteLatency(
      terminal,
      { ...plan, mode: 'chunked' },
      {
        requestedAtMs: 0,
        clipboardReadyAtMs: 5,
        plannedAtMs: 10
      }
    )
    advance(600)
    emit('data')
    advance(20)
    emit('parsed')
    advance(20)
    emit('render')
    capture?.complete({ status: 'cancelled', chunksWritten: 0, durationMs: 50, diagnostic: '' })
    advance(5_000)

    expect(recordBreadcrumb).not.toHaveBeenCalled()
  })

  it('records a completed paste when a queued paste starts its observation', () => {
    const { terminal } = terminalFixture()
    const times = { requestedAtMs: 0, clipboardReadyAtMs: 5, plannedAtMs: 10 }
    const first = captureTerminalPasteLatency(terminal, plan, times)
    advance(20)
    first?.markDispatched()
    advance(600)
    first?.complete({ status: 'pasted', chunksWritten: 1, durationMs: 600, diagnostic: '' })
    captureTerminalPasteLatency(terminal, plan, times)?.cancel()

    expect(recordBreadcrumb).toHaveBeenCalledWith(
      'terminal_paste_slow',
      expect.objectContaining({ status: 'pasted', writeMs: 600 })
    )
  })

  it('stops after a stalled paste even if execution never completes', () => {
    const { terminal, listenerCount } = terminalFixture()
    captureTerminalPasteLatency(terminal, plan, {
      requestedAtMs: 0,
      clipboardReadyAtMs: 5,
      plannedAtMs: 10
    })
    advance(20_000)

    expect(recordBreadcrumb).toHaveBeenCalledWith(
      'terminal_paste_slow',
      expect.objectContaining({ status: 'pending', writeMs: 20_000 })
    )
    expect(listenerCount()).toBe(0)
  })
})
