import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  countTerminalInputTextCodeUnits,
  createTerminalInputStreamProbe
} from './terminal-input-stream-probe'

const recordBreadcrumb = vi.hoisted(() => vi.fn())
const queuePressure = vi.hoisted(() => vi.fn())
vi.mock('@/lib/crash-breadcrumb-recorder', () => ({
  recordRendererCrashBreadcrumb: recordBreadcrumb
}))
vi.mock('@/lib/pane-manager/pane-terminal-output-queue-registry', () => ({
  getTerminalOutputQueuePressure: queuePressure
}))

describe('terminal input stream probe', () => {
  let now = 0

  beforeEach(() => {
    now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    vi.stubGlobal('document', { querySelectorAll: () => [1, 2] })
    recordBreadcrumb.mockClear()
    queuePressure.mockReturnValue({ queuedTerminalCount: 1, queuedChars: 24 })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('counts bracketed text and skips terminal control replies', () => {
    expect(countTerminalInputTextCodeUnits('typed')).toBe(5)
    expect(countTerminalInputTextCodeUnits('\x1b[A')).toBe(0)
    expect(countTerminalInputTextCodeUnits('\r')).toBe(0)
    expect(countTerminalInputTextCodeUnits('\x7f')).toBe(0)
    expect(countTerminalInputTextCodeUnits('')).toBe(0)
    expect(countTerminalInputTextCodeUnits('\x1b[200~')).toBe(0)
    expect(countTerminalInputTextCodeUnits('\x1b[200~pasted\x1b[201~')).toBe(6)
    expect(countTerminalInputTextCodeUnits('\x1b[200~partial')).toBe(7)
  })

  it('records a sustained word stream with counts only and limits report frequency', () => {
    const probe = createTerminalInputStreamProbe()
    for (let index = 0; index < 6; index += 1) {
      now = index * 2_000
      probe.observe(5, 2)
    }
    expect(recordBreadcrumb).toHaveBeenCalledWith(
      'terminal_input_stream',
      expect.objectContaining({
        elapsedMs: 10_000,
        events: 6,
        codeUnits: 30,
        multiUnitEvents: 6,
        maxEventGapMs: 2_000,
        maxForwardMs: 2,
        terminalPaneCount: 2,
        queuedChars: 24
      })
    )
    expect(JSON.stringify(recordBreadcrumb.mock.calls)).not.toContain('secret')
    for (let index = 1; index <= 6; index += 1) {
      now = 10_000 + index * 2_000
      probe.observe(5, 2)
    }
    expect(recordBreadcrumb).toHaveBeenCalledTimes(1)
  })

  it('keeps terminal input working when diagnostic pressure sampling fails', () => {
    const probe = createTerminalInputStreamProbe()
    queuePressure.mockImplementation(() => {
      throw new Error('diagnostic failure')
    })
    for (let index = 0; index < 6; index += 1) {
      now = index * 2_000
      expect(() => probe.observe(5, 2)).not.toThrow()
    }
    expect(recordBreadcrumb).not.toHaveBeenCalled()
  })

  it('records a large input event once per minute without retaining the input', () => {
    const probe = createTerminalInputStreamProbe()
    probe.observe(1426, 3, true)
    expect(recordBreadcrumb).toHaveBeenCalledWith(
      'terminal_input_bulk',
      expect.objectContaining({
        codeUnitsRoundedUp64: 1472,
        dispatchCallMs: 3,
        deferred: true,
        terminalPaneCount: 2
      })
    )
    now = 1_000
    probe.observe(2048, 2)
    expect(recordBreadcrumb).toHaveBeenCalledTimes(1)
    now = 60_000
    probe.observe(512, 2)
    expect(recordBreadcrumb).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(recordBreadcrumb.mock.calls)).not.toContain('secret')
  })
})
