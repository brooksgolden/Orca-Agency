import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTerminalInputStreamProbe } from './terminal-input-stream-probe'

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
})
