import { recordRendererCrashBreadcrumb } from './crash-breadcrumb-recorder'
import { getTerminalOutputQueuePressure } from './pane-manager/pane-terminal-output-queue-registry'

const MIN_FRAME_MS = 150
const REPORT_COOLDOWN_MS = 10_000

function finiteMetric(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function bundledAssetHash(value: unknown): number {
  if (typeof value !== 'string') {
    return 0
  }
  const name = value.match(/[/\\]assets[/\\]([A-Za-z0-9_.-]+\.js)(?:[?#]|$)/)?.[1]
  if (!name) {
    return 0
  }
  let hash = 2_166_136_261
  for (let index = 0; index < name.length; index += 1) {
    hash = Math.imul(hash ^ name.charCodeAt(index), 16_777_619)
  }
  return hash >>> 0
}

/** Records script and layout timing only when a foreground terminal frame is slow. */
export function installTerminalLongFrameProbe(): () => void {
  if (
    typeof window === 'undefined' ||
    typeof document === 'undefined' ||
    typeof PerformanceObserver === 'undefined' ||
    !PerformanceObserver.supportedEntryTypes?.includes('long-animation-frame')
  ) {
    return () => undefined
  }

  let lastReport = Number.NEGATIVE_INFINITY
  let observer: PerformanceObserver
  try {
    observer = new PerformanceObserver((list) => {
      try {
        if (document.visibilityState !== 'visible' || !document.hasFocus()) {
          return
        }
        const now = performance.now()
        if (now - lastReport < REPORT_COOLDOWN_MS) {
          return
        }
        const entry = list
          .getEntries()
          .reduce<PerformanceEntry | null>(
            (longest, candidate) =>
              candidate.duration >= MIN_FRAME_MS &&
              (!longest || candidate.duration > longest.duration)
                ? candidate
                : longest,
            null
          )
        if (!entry) {
          return
        }
        const terminalPaneCount = document.querySelectorAll('.xterm').length
        if (terminalPaneCount === 0) {
          return
        }

        const scripts: unknown = Reflect.get(entry, 'scripts')
        let topScript: unknown = null
        let topScriptMs = 0
        if (Array.isArray(scripts)) {
          for (const script of scripts) {
            const duration = finiteMetric(Reflect.get(script, 'duration')) ?? 0
            if (duration > topScriptMs) {
              topScript = script
              topScriptMs = duration
            }
          }
        }
        const start = entry.startTime
        const renderStart = finiteMetric(Reflect.get(entry, 'renderStart'))
        const layoutStart = finiteMetric(Reflect.get(entry, 'styleAndLayoutStart'))
        lastReport = now
        recordRendererCrashBreadcrumb('terminal_renderer_long_frame', {
          at: new Date(Date.now() - (now - start)).toISOString(),
          durationMs: Math.round(entry.duration),
          blockingDurationMs: Math.round(finiteMetric(Reflect.get(entry, 'blockingDuration')) ?? 0),
          renderStartOffsetMs:
            renderStart === null || renderStart < start ? -1 : Math.round(renderStart - start),
          layoutStartOffsetMs:
            layoutStart === null || layoutStart < start ? -1 : Math.round(layoutStart - start),
          scriptCount: Array.isArray(scripts) ? scripts.length : 0,
          topScriptMs: Math.round(topScriptMs),
          topScriptForcedLayoutMs: topScript
            ? Math.round(finiteMetric(Reflect.get(topScript, 'forcedStyleAndLayoutDuration')) ?? 0)
            : 0,
          topScriptSourceChar: topScript
            ? Math.round(finiteMetric(Reflect.get(topScript, 'sourceCharPosition')) ?? -1)
            : -1,
          topScriptAssetHash: topScript ? bundledAssetHash(Reflect.get(topScript, 'sourceURL')) : 0,
          terminalPaneCount,
          ...getTerminalOutputQueuePressure()
        })
      } catch {
        // Diagnostics must not interrupt terminal rendering.
      }
    })
    observer.observe({ type: 'long-animation-frame' })
  } catch {
    return () => undefined
  }
  return () => observer.disconnect()
}
