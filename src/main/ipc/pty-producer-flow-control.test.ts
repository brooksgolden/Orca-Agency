import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PRODUCER_FLOW_HIGH_WATERMARK_CHARS,
  PRODUCER_FLOW_LOW_WATERMARK_CHARS,
  PRODUCER_PAUSE_REASSERT_INTERVAL_MS,
  PtyProducerFlowController,
  type ProducerFlowRequestStatus
} from './pty-producer-flow-control'

const HIGH = PRODUCER_FLOW_HIGH_WATERMARK_CHARS
const LOW = PRODUCER_FLOW_LOW_WATERMARK_CHARS

describe('PtyProducerFlowController', () => {
  let pauseProducer: ReturnType<typeof vi.fn<(id: string) => ProducerFlowRequestStatus>>
  let resumeProducer: ReturnType<typeof vi.fn<(id: string) => ProducerFlowRequestStatus>>
  let controller: PtyProducerFlowController

  beforeEach(() => {
    vi.useFakeTimers()
    pauseProducer = vi.fn<(id: string) => ProducerFlowRequestStatus>(
      () => 'method-invoked-unconfirmed'
    )
    resumeProducer = vi.fn<(id: string) => ProducerFlowRequestStatus>(
      () => 'method-invoked-unconfirmed'
    )
    controller = new PtyProducerFlowController({
      pauseProducer,
      resumeProducer
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not pause at or below the high watermark', () => {
    controller.update('pty-1', 0)
    controller.update('pty-1', LOW)
    controller.update('pty-1', HIGH)
    expect(pauseProducer).not.toHaveBeenCalled()
    expect(controller.isPaused('pty-1')).toBe(false)
  })

  it('pauses exactly once when pending crosses the high watermark, not per chunk', () => {
    controller.update('pty-1', HIGH + 1)
    controller.update('pty-1', HIGH + 64 * 1024)
    controller.update('pty-1', HIGH + 128 * 1024)
    expect(pauseProducer).toHaveBeenCalledTimes(1)
    expect(pauseProducer).toHaveBeenCalledWith('pty-1')
    expect(controller.isPaused('pty-1')).toBe(true)
  })

  it('resumes exactly once when pending drains below the low watermark', () => {
    controller.update('pty-1', HIGH + 1)
    controller.update('pty-1', LOW - 1)
    expect(resumeProducer).toHaveBeenCalledTimes(1)
    expect(resumeProducer).toHaveBeenCalledWith('pty-1')
    expect(controller.isPaused('pty-1')).toBe(false)
    // A second drain report on the now-unpaused pty must not resume again.
    controller.update('pty-1', 0)
    expect(resumeProducer).toHaveBeenCalledTimes(1)
  })

  it('holds hysteresis: no flapping while pending sits between the watermarks', () => {
    controller.update('pty-1', HIGH + 1)
    expect(pauseProducer).toHaveBeenCalledTimes(1)
    // Draining but still above LOW: stay paused, no extra calls either way.
    controller.update('pty-1', HIGH - 16 * 1024)
    controller.update('pty-1', 128 * 1024)
    controller.update('pty-1', LOW)
    expect(pauseProducer).toHaveBeenCalledTimes(1)
    expect(resumeProducer).not.toHaveBeenCalled()
    expect(controller.isPaused('pty-1')).toBe(true)
    // An unpaused pty hovering in the same band must not pause.
    controller.update('pty-2', LOW + 1)
    controller.update('pty-2', HIGH)
    expect(pauseProducer).toHaveBeenCalledTimes(1)
  })

  it('re-asserts the pause after the failsafe interval while still flooded', () => {
    controller.update('pty-1', HIGH + 1)
    expect(pauseProducer).toHaveBeenCalledTimes(1)

    // Within the failsafe window: no re-assert even far above HIGH.
    vi.advanceTimersByTime(PRODUCER_PAUSE_REASSERT_INTERVAL_MS - 1)
    controller.update('pty-1', HIGH * 4)
    expect(pauseProducer).toHaveBeenCalledTimes(1)

    // After the window (daemon failsafe has auto-resumed by now): re-pause.
    vi.advanceTimersByTime(1)
    controller.update('pty-1', HIGH * 4)
    expect(pauseProducer).toHaveBeenCalledTimes(2)

    // The re-assert re-stamps the clock — no immediate third pause.
    controller.update('pty-1', HIGH * 4)
    expect(pauseProducer).toHaveBeenCalledTimes(2)
  })

  it('release resumes only ptys that are actually paused', () => {
    controller.update('paused-pty', HIGH + 1)
    controller.release('paused-pty')
    controller.release('never-paused-pty')
    expect(resumeProducer).toHaveBeenCalledTimes(1)
    expect(resumeProducer).toHaveBeenCalledWith('paused-pty')
    expect(controller.isPaused('paused-pty')).toBe(false)
  })

  it('releaseAll resumes every paused pty', () => {
    controller.update('pty-1', HIGH + 1)
    controller.update('pty-2', HIGH + 1)
    controller.update('pty-3', LOW)
    controller.releaseAll()
    expect(resumeProducer).toHaveBeenCalledTimes(2)
    expect(resumeProducer).toHaveBeenCalledWith('pty-1')
    expect(resumeProducer).toHaveBeenCalledWith('pty-2')
    expect(controller.isPaused('pty-1')).toBe(false)
    expect(controller.isPaused('pty-2')).toBe(false)
  })

  it('keeps bookkeeping consistent when the transport throws', () => {
    pauseProducer.mockImplementation(() => {
      throw new Error('provider gone')
    })
    resumeProducer.mockImplementation(() => {
      throw new Error('provider gone')
    })
    expect(() => controller.update('pty-1', HIGH + 1)).not.toThrow()
    expect(controller.isPaused('pty-1')).toBe(true)
    expect(() => controller.update('pty-1', 0)).not.toThrow()
    expect(controller.isPaused('pty-1')).toBe(false)
  })

  it('tracks watermark state per pty independently', () => {
    controller.update('pty-1', HIGH + 1)
    controller.update('pty-2', HIGH + 1)
    controller.update('pty-1', 0)
    expect(pauseProducer).toHaveBeenCalledTimes(2)
    expect(resumeProducer).toHaveBeenCalledTimes(1)
    expect(controller.isPaused('pty-1')).toBe(false)
    expect(controller.isPaused('pty-2')).toBe(true)
  })

  it('records only state transitions with pending counts and pause duration', () => {
    const onTransition = vi.fn()
    controller = new PtyProducerFlowController({ pauseProducer, resumeProducer }, { onTransition })

    controller.update('pty-1', HIGH)
    controller.update('pty-1', HIGH + 1)
    controller.update('pty-1', HIGH + 2)
    vi.advanceTimersByTime(PRODUCER_PAUSE_REASSERT_INTERVAL_MS)
    controller.update('pty-1', HIGH + 3)
    vi.advanceTimersByTime(7)
    controller.update('pty-1', LOW - 1)

    expect(onTransition.mock.calls.map(([transition]) => transition)).toEqual([
      {
        event: 'pause-request',
        id: 'pty-1',
        pendingChars: HIGH + 1,
        sinceInitialRequestMs: null,
        sinceLastRequestMs: null,
        trackedPausePtyCount: 1,
        requestStatus: 'method-invoked-unconfirmed'
      },
      {
        event: 'reassert-request',
        id: 'pty-1',
        pendingChars: HIGH + 3,
        sinceInitialRequestMs: PRODUCER_PAUSE_REASSERT_INTERVAL_MS,
        sinceLastRequestMs: PRODUCER_PAUSE_REASSERT_INTERVAL_MS,
        trackedPausePtyCount: 1,
        requestStatus: 'method-invoked-unconfirmed'
      },
      {
        event: 'resume-request',
        id: 'pty-1',
        pendingChars: LOW - 1,
        sinceInitialRequestMs: PRODUCER_PAUSE_REASSERT_INTERVAL_MS + 7,
        sinceLastRequestMs: 7,
        trackedPausePtyCount: 0,
        requestStatus: 'method-invoked-unconfirmed'
      }
    ])
  })

  it('records teardown release and ignores a failing diagnostic callback', () => {
    const onTransition = vi.fn().mockImplementationOnce(() => {
      throw new Error('diagnostic unavailable')
    })
    controller = new PtyProducerFlowController({ pauseProducer, resumeProducer }, { onTransition })

    expect(() => controller.update('pty-1', HIGH + 1)).not.toThrow()
    vi.advanceTimersByTime(12)
    controller.release('pty-1')

    expect(resumeProducer).toHaveBeenCalledWith('pty-1')
    expect(onTransition).toHaveBeenLastCalledWith({
      event: 'release-request',
      id: 'pty-1',
      pendingChars: null,
      sinceInitialRequestMs: 12,
      sinceLastRequestMs: 12,
      trackedPausePtyCount: 0,
      requestStatus: 'method-invoked-unconfirmed'
    })
  })

  it('records unsupported and failed provider requests without changing pause state', () => {
    const onTransition = vi.fn()
    pauseProducer.mockReturnValue('unsupported')
    resumeProducer.mockImplementation(() => {
      throw new Error('provider disconnected')
    })
    controller = new PtyProducerFlowController({ pauseProducer, resumeProducer }, { onTransition })

    controller.update('pty-1', HIGH + 1)
    expect(controller.isPaused('pty-1')).toBe(true)
    controller.update('pty-1', 0)
    expect(controller.isPaused('pty-1')).toBe(false)
    expect(onTransition.mock.calls.map(([event]) => event.requestStatus)).toEqual([
      'unsupported',
      'failed'
    ])
  })

  it('records every resumed producer during releaseAll', () => {
    const onTransition = vi.fn()
    controller = new PtyProducerFlowController({ pauseProducer, resumeProducer }, { onTransition })
    controller.update('pty-1', HIGH + 1)
    controller.update('pty-2', HIGH + 1)
    controller.releaseAll()

    expect(onTransition.mock.calls.map(([event]) => event.event)).toEqual([
      'pause-request',
      'pause-request',
      'release-request',
      'release-request'
    ])
    expect(controller.isPaused('pty-1')).toBe(false)
    expect(controller.isPaused('pty-2')).toBe(false)
  })
})
