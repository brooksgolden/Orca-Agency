import { recordRendererCrashBreadcrumb } from '@/lib/crash-breadcrumb-recorder'
import { getTerminalOutputQueuePressure } from '@/lib/pane-manager/pane-terminal-output-queue-registry'

const WINDOW_MS = 10_000
const MIN_EVENTS = 6
const MIN_CODE_UNITS = 20
const REPORT_COOLDOWN_MS = 60_000

/** Counts sustained terminal input without retaining any of its text. */
export function createTerminalInputStreamProbe(): {
  observe: (codeUnits: number, forwardMs: number) => void
} {
  let startedAt = 0
  let lastAt = 0
  let lastReportAt = Number.NEGATIVE_INFINITY
  let events = 0
  let codeUnits = 0
  let multiUnitEvents = 0
  let maxEventGapMs = 0
  let maxForwardMs = 0

  return {
    observe(inputCodeUnits, forwardMs): void {
      const now = performance.now()
      if (events === 0 || now - lastAt > WINDOW_MS) {
        startedAt = now
        events = 0
        codeUnits = 0
        multiUnitEvents = 0
        maxEventGapMs = 0
        maxForwardMs = 0
      } else {
        maxEventGapMs = Math.max(maxEventGapMs, now - lastAt)
      }
      lastAt = now
      events += 1
      codeUnits += inputCodeUnits
      if (inputCodeUnits > 1) {
        multiUnitEvents += 1
      }
      maxForwardMs = Math.max(maxForwardMs, forwardMs)

      const elapsedMs = now - startedAt
      if (elapsedMs < WINDOW_MS) {
        return
      }
      if (
        events >= MIN_EVENTS &&
        codeUnits >= MIN_CODE_UNITS &&
        now - lastReportAt >= REPORT_COOLDOWN_MS
      ) {
        lastReportAt = now
        try {
          recordRendererCrashBreadcrumb('terminal_input_stream', {
            at: new Date().toISOString(),
            elapsedMs: Math.round(elapsedMs),
            events,
            codeUnits,
            multiUnitEvents,
            maxEventGapMs: Math.round(maxEventGapMs),
            maxForwardMs: Math.round(maxForwardMs),
            terminalPaneCount: document.querySelectorAll('.xterm').length,
            ...getTerminalOutputQueuePressure()
          })
        } catch {
          // Diagnostic failures must never interrupt terminal input.
        }
      }
      startedAt = now
      events = 0
      codeUnits = 0
      multiUnitEvents = 0
      maxEventGapMs = 0
      maxForwardMs = 0
    }
  }
}
