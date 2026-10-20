import type { CrashReportBreadcrumbData } from '../../shared/crash-reporting'

export const TERMINAL_PASTE_SLOW_BREADCRUMB = 'terminal_paste_slow'
export const TERMINAL_RENDERER_GAP_BREADCRUMB = 'terminal_renderer_gap'
export const TERMINAL_RENDERER_LONG_FRAME_BREADCRUMB = 'terminal_renderer_long_frame'
export const TERMINAL_INPUT_DISPATCH_DELAY_BREADCRUMB = 'terminal_input_dispatch_delay'
export const TERMINAL_INPUT_STREAM_BREADCRUMB = 'terminal_input_stream'
export const TERMINAL_INPUT_BULK_BREADCRUMB = 'terminal_input_bulk'
const TERMINAL_OUTPUT_BACKLOG_DROPPED_BREADCRUMB = 'terminal_output_backlog_dropped'
const TERMINAL_PASTE_LABELS: Record<string, readonly string[]> = {
  source: [
    'keyboard',
    'paste-event',
    'app-menu',
    'context-menu',
    'right-click',
    'middle-click',
    'programmatic'
  ],
  mode: ['direct', 'chunked', 'bracketed-terminal', 'windows-input-record', 'reject'],
  runtime: ['local', 'wsl', 'ssh', 'remote-runtime'],
  status: ['pasted', 'rejected', 'cancelled', 'pending']
}
const TERMINAL_LATENCY_METRICS: Record<string, readonly string[]> = {
  [TERMINAL_PASTE_SLOW_BREADCRUMB]: [
    'bytes',
    'lines',
    'clipboardMs',
    'planningMs',
    'writeMs',
    'dispatchDelayMs',
    'rawPtyAfterDispatchMs',
    'queueAfterDispatchMs',
    'xtermWriteAfterDispatchMs',
    'matchedParseAfterDispatchMs',
    'matchedPaintAfterDispatchMs',
    'queuedForeground',
    'queuedLatencySensitive',
    'queuedHold',
    'queuedCoalesce',
    'parseAfterDispatchMs',
    'firstPaintDelayMs',
    'lastPaintDelayMs',
    'parsedBatches',
    'renderBatches'
  ],
  [TERMINAL_RENDERER_GAP_BREADCRUMB]: [
    'gapMs',
    'terminalPaneCount',
    'queuedTerminalCount',
    'queuedChars',
    'highPriorityTerminalCount',
    'heldForegroundTerminalCount'
  ],
  [TERMINAL_RENDERER_LONG_FRAME_BREADCRUMB]: [
    'durationMs',
    'blockingDurationMs',
    'renderStartOffsetMs',
    'layoutStartOffsetMs',
    'scriptCount',
    'topScriptMs',
    'topScriptForcedLayoutMs',
    'topScriptSourceChar',
    'topScriptAssetHash',
    'terminalPaneCount',
    'queuedTerminalCount',
    'queuedChars',
    'highPriorityTerminalCount',
    'heldForegroundTerminalCount'
  ],
  [TERMINAL_INPUT_DISPATCH_DELAY_BREADCRUMB]: [
    'delayMs',
    'terminalPaneCount',
    'queuedTerminalCount',
    'queuedChars',
    'highPriorityTerminalCount',
    'heldForegroundTerminalCount'
  ],
  [TERMINAL_INPUT_STREAM_BREADCRUMB]: [
    'elapsedMs',
    'events',
    'codeUnits',
    'multiUnitEvents',
    'maxEventGapMs',
    'maxForwardMs',
    'deferredEvents',
    'terminalPaneCount',
    'queuedTerminalCount',
    'queuedChars',
    'highPriorityTerminalCount',
    'heldForegroundTerminalCount'
  ],
  [TERMINAL_INPUT_BULK_BREADCRUMB]: [
    'codeUnitsRoundedUp64',
    'dispatchCallMs',
    'deferred',
    'terminalPaneCount',
    'queuedTerminalCount',
    'queuedChars',
    'highPriorityTerminalCount',
    'heldForegroundTerminalCount'
  ],
  [TERMINAL_OUTPUT_BACKLOG_DROPPED_BREADCRUMB]: ['foreground', 'droppedChars', 'capChars']
}
let terminalLatencyCapture: ((line: string) => void) | undefined
export function setTerminalLatencyCapture(capture?: (line: string) => void): void {
  terminalLatencyCapture = capture
}

export function recordTerminalLatency(
  name: string,
  data: CrashReportBreadcrumbData | undefined,
  origin?: string
): void {
  if (!Object.hasOwn(TERMINAL_LATENCY_METRICS, name)) {
    return
  }
  const keys = TERMINAL_LATENCY_METRICS[name]
  if (!terminalLatencyCapture) {
    return
  }
  const metrics: Record<string, number | boolean> = {}
  for (const key of keys) {
    const value = data?.[key]
    if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) {
      metrics[key] = value
    }
  }
  const labels: Record<string, string> = {}
  if (name === TERMINAL_PASTE_SLOW_BREADCRUMB) {
    for (const [key, allowed] of Object.entries(TERMINAL_PASTE_LABELS)) {
      const value = data?.[key]
      if (typeof value === 'string' && allowed.includes(value)) {
        labels[key] = value
      }
    }
  }
  if (name === TERMINAL_INPUT_DISPATCH_DELAY_BREADCRUMB) {
    const kind = data?.kind
    if (kind === 'keydown' || kind === 'input' || kind === 'wheel') {
      labels.kind = kind
    }
  }
  const rendererAt = data?.at
  terminalLatencyCapture(
    JSON.stringify({
      at: new Date().toISOString(),
      name,
      ...(origin ? { origin } : {}),
      ...(typeof rendererAt === 'string' &&
      /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(rendererAt)
        ? { rendererAt }
        : {}),
      ...(Object.keys(labels).length ? { labels } : {}),
      metrics
    })
  )
}
