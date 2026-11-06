import type { TerminalPasteExecutionResult, TerminalPastePlan } from './terminal-paste-model'
import { recordRendererCrashBreadcrumb } from '@/lib/crash-breadcrumb-recorder'

type Disposable = { dispose: () => void }
type PasteLatencyTerminal = {
  onWriteParsed?: (listener: () => void) => Disposable
  onRender?: (listener: () => void) => Disposable
}

const MIN_OBSERVE_MS = 5_000
const MAX_OBSERVE_MS = 20_000
const SLOW_MS = 500
const active = new WeakMap<PasteLatencyTerminal, () => void>()
type OutputObservation = {
  rawPtyAtMs: number | null
  queuedAtMs: number | null
  xtermWriteAtMs: number | null
  matchedParseAtMs: number | null
  matchedPaintAtMs: number | null
  queuedForeground: boolean | null
  queuedLatencySensitive: boolean | null
  queuedHold: boolean | null
  queuedCoalesce: boolean | null
  dispatchedAtMs: number | null
}
const observations = new WeakMap<PasteLatencyTerminal, OutputObservation>()
let activeObservations = 0

export function noteTerminalPasteRawPtyOutput(terminal: PasteLatencyTerminal): void {
  if (activeObservations === 0) {
    return
  }
  const observation = observations.get(terminal)
  if (observation && observation.dispatchedAtMs !== null && observation.rawPtyAtMs === null) {
    observation.rawPtyAtMs = performance.now()
  }
}

export function noteTerminalPasteOutputQueued(
  terminal: PasteLatencyTerminal,
  options: { foreground: boolean; latencySensitive: boolean; hold: boolean; coalesce: boolean }
): { onWrite: () => void; onParsed: () => void } | null {
  if (activeObservations === 0) {
    return null
  }
  const observation = observations.get(terminal)
  if (
    !observation ||
    observation.dispatchedAtMs === null ||
    observation.rawPtyAtMs === null ||
    observation.queuedAtMs !== null
  ) {
    return null
  }
  observation.queuedAtMs = performance.now()
  observation.queuedForeground = options.foreground
  observation.queuedLatencySensitive = options.latencySensitive
  observation.queuedHold = options.hold
  observation.queuedCoalesce = options.coalesce
  return {
    onWrite: () => {
      if (observations.get(terminal) === observation) {
        observation.xtermWriteAtMs ??= performance.now()
      }
    },
    onParsed: () => {
      if (observations.get(terminal) === observation && observation.xtermWriteAtMs !== null) {
        observation.matchedParseAtMs ??= performance.now()
      }
    }
  }
}

export function captureTerminalPasteLatency(
  terminal: PasteLatencyTerminal,
  plan: TerminalPastePlan,
  times: { requestedAtMs: number; clipboardReadyAtMs: number; plannedAtMs: number }
): {
  markDispatched: () => void
  complete: (result: TerminalPasteExecutionResult) => void
  cancel: () => void
} | null {
  if (!terminal.onWriteParsed || !terminal.onRender) {
    return null
  }
  active.get(terminal)?.()

  const source = plan.payload.source
  const mode = plan.mode
  const runtime = plan.target.runtime.kind
  const paneId = plan.target.paneId
  const bytes = plan.payload.byteLength
  const lines = plan.payload.lineCount
  const startedAtMs = performance.now()
  const disposables: Disposable[] = []
  let firstDispatchAtMs: number | null = null
  let firstParseAtMs: number | null = null
  let firstRenderAtMs: number | null = null
  let lastRenderAtMs: number | null = null
  let parsedBatches = 0
  let renderBatches = 0
  let result: TerminalPasteExecutionResult | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let maxTimer: ReturnType<typeof setTimeout> | null = null
  let closed = false
  const observation: OutputObservation = {
    rawPtyAtMs: null,
    queuedAtMs: null,
    xtermWriteAtMs: null,
    matchedParseAtMs: null,
    matchedPaintAtMs: null,
    queuedForeground: null,
    queuedLatencySensitive: null,
    queuedHold: null,
    queuedCoalesce: null,
    dispatchedAtMs: null
  }
  observations.set(terminal, observation)
  activeObservations++

  const stop = (record = true): void => {
    if (closed) {
      return
    }
    closed = true
    if (timer) {
      clearTimeout(timer)
    }
    if (maxTimer) {
      clearTimeout(maxTimer)
    }
    for (const disposable of disposables) {
      disposable.dispose()
    }
    active.delete(terminal)
    observations.delete(terminal)
    activeObservations--
    if (!record) {
      return
    }
    const writeMs = result?.durationMs ?? rounded(performance.now() - startedAtMs)

    const dispatchDelayMs =
      firstDispatchAtMs === null ? null : firstDispatchAtMs - times.requestedAtMs
    const parseDelayMs =
      firstParseAtMs === null || firstDispatchAtMs === null
        ? null
        : firstParseAtMs - firstDispatchAtMs
    const firstPaintDelayMs =
      firstRenderAtMs === null ? null : firstRenderAtMs - times.requestedAtMs
    const lastPaintDelayMs = lastRenderAtMs === null ? null : lastRenderAtMs - times.requestedAtMs
    if (
      Math.max(writeMs, dispatchDelayMs ?? 0, parseDelayMs ?? 0, firstPaintDelayMs ?? 0) < SLOW_MS
    ) {
      return
    }

    // Output is temporal evidence, since an agent may also draw status while paste settles.
    recordRendererCrashBreadcrumb('terminal_paste_slow', {
      at: new Date().toISOString(),
      attribution: 'temporal',
      source,
      mode,
      runtime,
      paneId,
      bytes,
      lines,
      status: result?.status ?? 'pending',
      clipboardMs: rounded(times.clipboardReadyAtMs - times.requestedAtMs),
      planningMs: rounded(times.plannedAtMs - times.clipboardReadyAtMs),
      writeMs,
      dispatchDelayMs: dispatchDelayMs === null ? -1 : rounded(dispatchDelayMs),
      rawPtyAfterDispatchMs: afterDispatch(observation.rawPtyAtMs, firstDispatchAtMs),
      queueAfterDispatchMs: afterDispatch(observation.queuedAtMs, firstDispatchAtMs),
      xtermWriteAfterDispatchMs: afterDispatch(observation.xtermWriteAtMs, firstDispatchAtMs),
      matchedParseAfterDispatchMs: afterDispatch(observation.matchedParseAtMs, firstDispatchAtMs),
      matchedPaintAfterDispatchMs: afterDispatch(observation.matchedPaintAtMs, firstDispatchAtMs),
      ...(observation.queuedAtMs !== null
        ? {
            queuedForeground: observation.queuedForeground,
            queuedLatencySensitive: observation.queuedLatencySensitive,
            queuedHold: observation.queuedHold,
            queuedCoalesce: observation.queuedCoalesce
          }
        : {}),
      parseAfterDispatchMs: parseDelayMs === null ? -1 : rounded(parseDelayMs),
      firstPaintDelayMs: firstPaintDelayMs === null ? -1 : rounded(firstPaintDelayMs),
      lastPaintDelayMs: lastPaintDelayMs === null ? -1 : rounded(lastPaintDelayMs),
      parsedBatches,
      renderBatches
    })
  }

  const scheduleStop = (): void => {
    if (timer) {
      clearTimeout(timer)
    }
    if (!result || closed) {
      return
    }
    const elapsed = performance.now() - startedAtMs
    timer = setTimeout(stop, Math.max(0, MIN_OBSERVE_MS - elapsed))
  }

  disposables.push(
    terminal.onWriteParsed(() => {
      // A busy agent can parse its own output before this paste reaches the PTY.
      // That output cannot establish a paste-to-parser latency.
      if (firstDispatchAtMs === null) {
        return
      }
      firstParseAtMs ??= performance.now()
      parsedBatches++
    })
  )
  disposables.push(
    terminal.onRender(() => {
      // Likewise, paints queued before the first post-dispatch parse are unrelated
      // temporal evidence. Preserve only the ordered dispatch -> parse -> paint path.
      if (firstParseAtMs === null) {
        return
      }
      const at = performance.now()
      firstRenderAtMs ??= at
      lastRenderAtMs = at
      if (observation.matchedParseAtMs !== null) {
        observation.matchedPaintAtMs ??= at
      }
      renderBatches++
    })
  )
  maxTimer = setTimeout(stop, MAX_OBSERVE_MS)
  active.set(terminal, stop)

  return {
    markDispatched: () => {
      firstDispatchAtMs ??= performance.now()
      observation.dispatchedAtMs = firstDispatchAtMs
    },
    complete: (execution) => {
      result = execution
      scheduleStop()
    },
    cancel: () => stop(false)
  }
}

function rounded(value: number): number {
  return Math.max(0, Math.round(value))
}

function afterDispatch(atMs: number | null, dispatchedAtMs: number | null): number {
  return atMs === null || dispatchedAtMs === null ? -1 : rounded(atMs - dispatchedAtMs)
}
