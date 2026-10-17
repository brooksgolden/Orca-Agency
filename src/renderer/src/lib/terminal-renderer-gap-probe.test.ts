import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installTerminalRendererGapProbe } from './terminal-renderer-gap-probe'

const recordBreadcrumb = vi.hoisted(() => vi.fn())
vi.mock('./crash-breadcrumb-recorder', () => ({
  recordRendererCrashBreadcrumb: recordBreadcrumb
}))

describe('terminal renderer gap probe', () => {
  let now = 0
  let focused = true
  let visible = true
  let terminalCount = 2

  function tick(elapsedMs: number): void {
    now += elapsedMs
    vi.advanceTimersByTime(100)
  }

  beforeEach(() => {
    now = 0
    focused = true
    visible = true
    terminalCount = 2
    vi.useFakeTimers()
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    vi.stubGlobal('window', { setInterval, clearInterval })
    vi.stubGlobal('document', {
      get visibilityState() {
        return visible ? 'visible' : 'hidden'
      },
      hasFocus: () => focused,
      querySelectorAll: () => Array.from({ length: terminalCount })
    })
    recordBreadcrumb.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('records a foreground terminal stall without content and stops on dispose', () => {
    const dispose = installTerminalRendererGapProbe()
    tick(100)
    tick(1_400)
    expect(recordBreadcrumb).toHaveBeenCalledWith(
      'terminal_renderer_gap',
      expect.objectContaining({ gapMs: 1_300, terminalPaneCount: 2 })
    )
    dispose()
    tick(2_000)
    expect(recordBreadcrumb).toHaveBeenCalledTimes(1)
  })

  it('ignores hidden, focus-transition, and terminal-free timer gaps', () => {
    const dispose = installTerminalRendererGapProbe()
    visible = false
    tick(2_000)
    visible = true
    tick(2_000)
    focused = false
    tick(2_000)
    focused = true
    tick(2_000)
    terminalCount = 0
    tick(2_000)
    expect(recordBreadcrumb).not.toHaveBeenCalled()
    dispose()
  })
})
