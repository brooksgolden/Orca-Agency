import { recordRendererCrashBreadcrumb } from './crash-breadcrumb-recorder'
import { getTerminalOutputQueuePressure } from './pane-manager/pane-terminal-output-queue-registry'

const TICK_MS = 100
const REPORT_GAP_MS = 100
const REPORT_INPUT_DELAY_MS = 250
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
  let lastInputReport = Number.NEGATIVE_INFINITY

  const onTerminalInput = (event: Event): void => {
    if (!event.isTrusted) {
      return
    }
    const now = performance.now()
    // Ignore epoch-based or synthetic timestamps; only a matching monotonic clock is useful.
    const delayMs = now - event.timeStamp
    if (
      !Number.isFinite(delayMs) ||
      delayMs < REPORT_INPUT_DELAY_MS ||
      delayMs > MAX_WAKE_GAP_MS ||
      now - lastInputReport < REPORT_COOLDOWN_MS
    ) {
      return
    }
    if (!isForeground()) {
      return
    }
    const target = event.target
    if (!(target instanceof Element) || !target.closest('.xterm')) {
      return
    }
    lastInputReport = now
    try {
      recordRendererCrashBreadcrumb('terminal_input_dispatch_delay', {
        at: new Date().toISOString(),
        kind: event.type,
        delayMs: Math.round(delayMs),
        terminalPaneCount: document.querySelectorAll('.xterm').length,
        ...getTerminalOutputQueuePressure()
      })
    } catch {
      // Diagnostics must not interrupt input.
    }
  }
  document.addEventListener('keydown', onTerminalInput, true)
  document.addEventListener('input', onTerminalInput, true)
  document.addEventListener('wheel', onTerminalInput, { capture: true, passive: true })
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
    try {
      recordRendererCrashBreadcrumb('terminal_renderer_gap', {
        at: new Date().toISOString(),
        gapMs: Math.round(gapMs),
        terminalPaneCount,
        ...getTerminalOutputQueuePressure()
      })
    } catch {
      // Diagnostics must not interrupt input.
    }
  }, TICK_MS)
  return () => {
    window.clearInterval(timer)
    document.removeEventListener('keydown', onTerminalInput, true)
    document.removeEventListener('input', onTerminalInput, true)
    document.removeEventListener('wheel', onTerminalInput, true)
  }
}
