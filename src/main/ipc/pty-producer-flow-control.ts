// Producer-side PTY flow control (notes/terminal-performance-initiative.md §5).
// Main tracks per-PTY renderer-pending chars; past HIGH it asks the provider to
// pause the actual PTY read (node-pty pause() → kernel backpressure → the
// flooding shell blocks on write), and below LOW it resumes. The wide
// HIGH/LOW gap is deliberate hysteresis so a draining queue cannot flap
// pause/resume once per flush slice.

export const PRODUCER_FLOW_HIGH_WATERMARK_CHARS = 256 * 1024
export const PRODUCER_FLOW_LOW_WATERMARK_CHARS = 32 * 1024
// Why: the daemon auto-resumes a pause after its 5s lost-resume failsafe. If
// pending is still above HIGH after that window, the pause must be re-asserted
// or a sustained flood would run unthrottled after the first failsafe fires.
export const PRODUCER_PAUSE_REASSERT_INTERVAL_MS = 5_000

export type ProducerFlowControlTransport = {
  pauseProducer: (id: string) => ProducerFlowRequestStatus
  resumeProducer: (id: string) => ProducerFlowRequestStatus
}

export type ProducerFlowRequestStatus =
  | 'method-invoked-unconfirmed'
  | 'missing-provider'
  | 'unsupported'
  | 'failed'

export type ProducerFlowTransition = {
  event: 'pause-request' | 'reassert-request' | 'resume-request' | 'release-request'
  id: string
  pendingChars: number | null
  sinceInitialRequestMs: number | null
  sinceLastRequestMs: number | null
  trackedPausePtyCount: number
  requestStatus: ProducerFlowRequestStatus
}

type PauseTimes = { reassertAtWallMs: number; firstAtPerfMs: number; lastAtPerfMs: number }

export class PtyProducerFlowController {
  private transport: ProducerFlowControlTransport
  private highWatermarkChars: number
  private lowWatermarkChars: number
  private reassertIntervalMs: number
  private pausedAtByPty = new Map<string, PauseTimes>()
  private onTransition?: (transition: ProducerFlowTransition) => void

  constructor(
    transport: ProducerFlowControlTransport,
    opts: {
      highWatermarkChars?: number
      lowWatermarkChars?: number
      reassertIntervalMs?: number
      onTransition?: (transition: ProducerFlowTransition) => void
    } = {}
  ) {
    this.transport = transport
    this.highWatermarkChars = opts.highWatermarkChars ?? PRODUCER_FLOW_HIGH_WATERMARK_CHARS
    this.lowWatermarkChars = opts.lowWatermarkChars ?? PRODUCER_FLOW_LOW_WATERMARK_CHARS
    this.reassertIntervalMs = opts.reassertIntervalMs ?? PRODUCER_PAUSE_REASSERT_INTERVAL_MS
    this.onTransition = opts.onTransition
  }

  /** Reports the current pending chars for a PTY. Fires pause exactly once at
   *  the HIGH crossing (re-asserted only after the failsafe interval) and
   *  resume exactly once when pending drains below LOW. */
  update(id: string, pendingChars: number): void {
    const pausedAt = this.pausedAtByPty.get(id)
    if (pausedAt === undefined) {
      if (pendingChars > this.highWatermarkChars) {
        const nowPerf = performance.now()
        this.pausedAtByPty.set(id, {
          reassertAtWallMs: Date.now(),
          firstAtPerfMs: nowPerf,
          lastAtPerfMs: nowPerf
        })
        const requestStatus = this.safePause(id)
        this.recordTransition('pause-request', id, pendingChars, null, null, requestStatus)
      }
      return
    }
    if (pendingChars < this.lowWatermarkChars) {
      this.pausedAtByPty.delete(id)
      const requestStatus = this.safeResume(id)
      const nowPerf = performance.now()
      this.recordTransition(
        'resume-request',
        id,
        pendingChars,
        nowPerf - pausedAt.firstAtPerfMs,
        nowPerf - pausedAt.lastAtPerfMs,
        requestStatus
      )
      return
    }
    if (
      pendingChars > this.highWatermarkChars &&
      Date.now() - pausedAt.reassertAtWallMs >= this.reassertIntervalMs
    ) {
      const nowPerf = performance.now()
      this.pausedAtByPty.set(id, {
        ...pausedAt,
        reassertAtWallMs: Date.now(),
        lastAtPerfMs: nowPerf
      })
      const requestStatus = this.safePause(id)
      this.recordTransition(
        'reassert-request',
        id,
        pendingChars,
        nowPerf - pausedAt.firstAtPerfMs,
        nowPerf - pausedAt.lastAtPerfMs,
        requestStatus
      )
    }
  }

  /** Resumes a PTY if it was paused. For teardown paths (exit, kill) where
   *  the pending bookkeeping is being dropped rather than drained. */
  release(id: string): void {
    const pausedAt = this.pausedAtByPty.get(id)
    if (pausedAt !== undefined) {
      this.pausedAtByPty.delete(id)
      const requestStatus = this.safeResume(id)
      const nowPerf = performance.now()
      this.recordTransition(
        'release-request',
        id,
        null,
        nowPerf - pausedAt.firstAtPerfMs,
        nowPerf - pausedAt.lastAtPerfMs,
        requestStatus
      )
    }
  }

  /** Resumes every paused PTY. For wholesale bookkeeping wipes (window
   *  destroyed) — a local PTY left paused here would stay wedged forever. */
  releaseAll(): void {
    // Deleting the visited entry during Map key iteration is spec-safe.
    for (const id of this.pausedAtByPty.keys()) {
      this.release(id)
    }
  }

  isPaused(id: string): boolean {
    return this.pausedAtByPty.has(id)
  }

  private recordTransition(
    event: ProducerFlowTransition['event'],
    id: string,
    pendingChars: number | null,
    sinceInitialRequestMs: number | null,
    sinceLastRequestMs: number | null,
    requestStatus: ProducerFlowRequestStatus
  ): void {
    try {
      this.onTransition?.({
        event,
        id,
        pendingChars,
        sinceInitialRequestMs,
        sinceLastRequestMs,
        trackedPausePtyCount: this.pausedAtByPty.size,
        requestStatus
      })
    } catch {
      // Diagnostic failures must not interrupt terminal delivery.
    }
  }

  // Why swallow: pause/resume are optimizations riding the terminal data
  // path — a provider throw must never break delivery or exit handling.
  private safePause(id: string): ProducerFlowRequestStatus {
    try {
      return this.transport.pauseProducer(id)
    } catch {
      return 'failed'
    }
  }

  private safeResume(id: string): ProducerFlowRequestStatus {
    try {
      return this.transport.resumeProducer(id)
    } catch {
      return 'failed'
    }
  }
}
