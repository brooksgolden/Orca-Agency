import { recordRendererCrashBreadcrumb } from './crash-breadcrumb-recorder'
import { getTerminalOutputQueuePressure } from './pane-manager/pane-terminal-output-queue-registry'

const TICK_MS = 100
const REPORT_GAP_MS = 1_000
const MAX_WAKE_GAP_MS = 30_000
const REPORT_COOLDOWN_MS = 10_000

function isForeground(): boolean {
  return document.visibilityState === 'visible' && document.hasFocus()
}

export function installTerminalRendererGapProbe(): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return () => undefined
  }

  let previousTick = performance.now()
  let previousForeground = isForeground()
  let lastReport = Number.NEGATIVE_INFINITY
  const timer = window.setInterval(() => {
    const now = performance.now()
    const gapMs = Math.max(0, now - previousTick - TICK_MS)
    const foreground = isForeground()
    previousTick = now

    // Why: background timer clamping and focus transitions are not terminal freezes.
    if (!foreground || !previousForeground) {
      previousForeground = foreground
      return
    }
    previousForeground = foreground
    if (gapMs < REPORT_GAP_MS || gapMs > MAX_WAKE_GAP_MS || now - lastReport < REPORT_COOLDOWN_MS) {
      return
    }
    const terminalPaneCount = document.querySelectorAll('.xterm').length
    if (terminalPaneCount === 0) {
      return
    }
    lastReport = now
    recordRendererCrashBreadcrumb('terminal_renderer_gap', {
      at: new Date().toISOString(),
      gapMs: Math.round(gapMs),
      terminalPaneCount,
      ...getTerminalOutputQueuePressure()
    })
  }, TICK_MS)
  return () => window.clearInterval(timer)
}
