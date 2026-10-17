import type { TerminalPasteExecutionResult, TerminalPastePlan } from './terminal-paste-model'
import { recordRendererCrashBreadcrumb } from '@/lib/crash-breadcrumb-recorder'

type Disposable = { dispose: () => void }
type PasteLatencyTerminal = {
  onData?: (listener: () => void) => Disposable
  onWriteParsed?: (listener: () => void) => Disposable
  onRender?: (listener: () => void) => Disposable
}

const MIN_OBSERVE_MS = 5_000
const MAX_OBSERVE_MS = 20_000
const SLOW_MS = 500
const active = new WeakMap<PasteLatencyTerminal, () => void>()

export function captureTerminalPasteLatency(
  terminal: PasteLatencyTerminal,
  plan: TerminalPastePlan,
  times: { requestedAtMs: number; clipboardReadyAtMs: number; plannedAtMs: number }
): {
  complete: (result: TerminalPasteExecutionResult) => void
  cancel: () => void
} | null {
  if (!terminal.onData || !terminal.onWriteParsed || !terminal.onRender) {
    return null
  }
  active.get(terminal)?.()

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
    if (!record) {
      return
    }
    const writeMs = result?.durationMs ?? rounded(performance.now() - startedAtMs)

    const dispatchDelayMs =
      firstDispatchAtMs === null ? null : firstDispatchAtMs - times.requestedAtMs
    const parseDelayMs =
      firstParseAtMs === null ? null : firstParseAtMs - (firstDispatchAtMs ?? startedAtMs)
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
      source: plan.payload.source,
      mode: plan.mode,
      runtime: plan.target.runtime.kind,
      paneId: plan.target.paneId,
      bytes: plan.payload.byteLength,
      lines: plan.payload.lineCount,
      status: result?.status ?? 'pending',
      clipboardMs: rounded(times.clipboardReadyAtMs - times.requestedAtMs),
      planningMs: rounded(times.plannedAtMs - times.clipboardReadyAtMs),
      writeMs,
      dispatchDelayMs: dispatchDelayMs === null ? -1 : rounded(dispatchDelayMs),
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
    terminal.onData(() => {
      firstDispatchAtMs ??= performance.now()
    })
  )
  disposables.push(
    terminal.onWriteParsed(() => {
      firstParseAtMs ??= performance.now()
      parsedBatches++
    })
  )
  disposables.push(
    terminal.onRender(() => {
      const at = performance.now()
      firstRenderAtMs ??= at
      lastRenderAtMs = at
      renderBatches++
    })
  )
  maxTimer = setTimeout(stop, MAX_OBSERVE_MS)
  active.set(terminal, stop)

  return {
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
