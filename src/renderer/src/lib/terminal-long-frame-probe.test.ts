import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installTerminalLongFrameProbe } from './terminal-long-frame-probe'

const recordBreadcrumb = vi.hoisted(() => vi.fn())
const queuePressure = vi.hoisted(() => vi.fn())
vi.mock('./crash-breadcrumb-recorder', () => ({
  recordRendererCrashBreadcrumb: recordBreadcrumb
}))
vi.mock('./pane-manager/pane-terminal-output-queue-registry', () => ({
  getTerminalOutputQueuePressure: queuePressure
}))

describe('terminal long frame probe', () => {
  let deliver: PerformanceObserverCallback | null
  let now: number
  let focused: boolean
  let paneCount: number
  const disconnect = vi.fn()
  const observe = vi.fn()

  beforeEach(() => {
    deliver = null
    now = 30_000
    focused = true
    paneCount = 2
    disconnect.mockClear()
    observe.mockClear()
    recordBreadcrumb.mockClear()
    queuePressure.mockReturnValue({ queuedChars: 16, queuedTerminalCount: 1 })
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    vi.stubGlobal('window', {})
    vi.stubGlobal('document', {
      visibilityState: 'visible',
      hasFocus: () => focused,
      querySelectorAll: () => Array.from({ length: paneCount })
    })
    class Observer {
      static supportedEntryTypes = ['long-animation-frame']
      observe = observe
      disconnect = disconnect
      constructor(callback: PerformanceObserverCallback) {
        deliver = callback
      }
    }
    vi.stubGlobal('PerformanceObserver', Observer)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  function emit(...frames: Record<string, unknown>[]): void {
    if (!deliver) {
      throw new Error('observer not installed')
    }
    Reflect.apply(deliver, null, [{ getEntries: () => frames }, {}])
  }

  it('records bounded script and layout timing without source URLs or terminal text', () => {
    const dispose = installTerminalLongFrameProbe()
    expect(observe).toHaveBeenCalledWith({ type: 'long-animation-frame' })
    emit({
      startTime: 4_000,
      duration: 800,
      blockingDuration: 640,
      renderStart: 4_500,
      styleAndLayoutStart: 4_600,
      scripts: [
        {
          duration: 520,
          forcedStyleAndLayoutDuration: 125,
          sourceURL: 'file:///C:/Users/private/renderer/assets/index-ABC123.js?secret=value',
          sourceCharPosition: 432,
          sourceFunctionName: 'privateFunction'
        }
      ]
    })
    expect(recordBreadcrumb).toHaveBeenCalledWith(
      'terminal_renderer_long_frame',
      expect.objectContaining({
        durationMs: 800,
        blockingDurationMs: 640,
        renderStartOffsetMs: 500,
        layoutStartOffsetMs: 600,
        scriptCount: 1,
        topScriptMs: 520,
        topScriptForcedLayoutMs: 125,
        topScriptSourceChar: 432,
        terminalPaneCount: 2,
        queuedChars: 16
      })
    )
    const data = JSON.stringify(recordBreadcrumb.mock.calls)
    expect(recordBreadcrumb.mock.calls[0][1].topScriptAssetHash).toBeGreaterThan(0)
    expect(data).not.toContain('private')
    expect(data).not.toContain('secret')
    dispose()
    expect(disconnect).toHaveBeenCalledTimes(1)
  })

  it('refuses background frames and rate limits foreground frames', () => {
    installTerminalLongFrameProbe()
    const frame = { startTime: 4_000, duration: 800, blockingDuration: 500 }
    focused = false
    emit(frame)
    expect(recordBreadcrumb).not.toHaveBeenCalled()
    focused = true
    paneCount = 0
    emit(frame)
    expect(recordBreadcrumb).not.toHaveBeenCalled()
    paneCount = 2
    emit(frame)
    now += 1_000
    emit(frame)
    expect(recordBreadcrumb).toHaveBeenCalledTimes(1)
  })

  it('marks missing render timing and unrecognized script assets explicitly', () => {
    installTerminalLongFrameProbe()
    vi.spyOn(Date, 'now').mockReturnValue(100_000)
    emit(
      { startTime: 3_000, duration: 200, renderStart: 0, styleAndLayoutStart: 0 },
      {
        startTime: 4_000,
        duration: 800,
        renderStart: 0,
        styleAndLayoutStart: 0,
        scripts: [{ duration: 400, sourceURL: 'https://example.com/private.js' }]
      }
    )
    const result = recordBreadcrumb.mock.calls[0][1]
    expect(result.renderStartOffsetMs).toBe(-1)
    expect(result.layoutStartOffsetMs).toBe(-1)
    expect(result.topScriptAssetHash).toBe(0)
    expect(result.durationMs).toBe(800)
    expect(result.at).toBe(new Date(74_000).toISOString())
  })

  it('ignores frames below the reporting threshold and unsupported browsers', () => {
    installTerminalLongFrameProbe()
    emit({ startTime: 4_000, duration: 149 })
    expect(recordBreadcrumb).not.toHaveBeenCalled()
    vi.stubGlobal('PerformanceObserver', undefined)
    installTerminalLongFrameProbe()()
    expect(recordBreadcrumb).not.toHaveBeenCalled()
  })
})
