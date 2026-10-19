import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  automationProcessTreePids,
  scheduleLocalAutomationPriorityFollowups
} from './local-automation-process-priority'
import {
  getRegisteredPtyProcessStartTime,
  registerPty,
  unregisterPty
} from '../memory/pty-registry'
import {
  isWindowsProcessStartTimeAvailable,
  readWindowsProcessCreationTime
} from '../windows/windows-process-table'

afterEach(() => vi.useRealTimers())

describe('local automation process priority', () => {
  it('includes only the automation terminal descendants', () => {
    expect(
      automationProcessTreePids(100, 1_000, [
        { pid: 100, ppid: 1, creationTimeMs: 1_000 },
        { pid: 101, ppid: 100, creationTimeMs: 1_100 },
        { pid: 102, ppid: 101, creationTimeMs: 1_200 },
        { pid: 103, ppid: 100, creationTimeMs: 1_300 },
        { pid: 201, ppid: 200, creationTimeMs: 1_200 },
        { pid: 202, ppid: 201, creationTimeMs: 1_300 }
      ]).sort((a, b) => a - b)
    ).toEqual([101, 102, 103])
  })

  it('rejects stale parent PIDs and every branch without creation times', () => {
    const rows = [
      { pid: 100, ppid: 1, creationTimeMs: 2_000 },
      { pid: 101, ppid: 100, creationTimeMs: 2_100 },
      { pid: 102, ppid: 101, creationTimeMs: 2_200 },
      // A terminated process left 100 as this child's ppid. PID 100 was reused.
      { pid: 201, ppid: 100, creationTimeMs: 1_500 },
      { pid: 202, ppid: 201, creationTimeMs: 1_600 },
      { pid: 301, ppid: 100 },
      { pid: 302, ppid: 301, creationTimeMs: 2_300 }
    ]
    expect(automationProcessTreePids(100, 2_000, rows)).toEqual([101, 102])
    expect(automationProcessTreePids(100, 1_000, rows)).toEqual([])
  })

  it.skipIf(process.platform !== 'win32' || !isWindowsProcessStartTimeAvailable())(
    'anchors a registered PTY to the process start time and removes it on teardown',
    () => {
      const ptyId = 'priority-root-test'
      registerPty({ ptyId, worktreeId: null, sessionId: null, paneKey: null, pid: process.pid })
      try {
        expect(getRegisteredPtyProcessStartTime(ptyId, process.pid)).toBe(
          readWindowsProcessCreationTime(process.pid)
        )
        expect(getRegisteredPtyProcessStartTime(ptyId, process.pid + 1)).toBeNull()
      } finally {
        unregisterPty(ptyId)
      }
      expect(getRegisteredPtyProcessStartTime(ptyId, process.pid)).toBeNull()
    }
  )

  it.skipIf(process.platform !== 'win32')(
    'stops follow-up priority changes when a pane gets a new PTY',
    async () => {
      vi.useFakeTimers()
      let ownsPty = true
      const lower = vi.fn(async () => {})
      scheduleLocalAutomationPriorityFollowups('original-pty', () => ownsPty, lower)

      await vi.advanceTimersByTimeAsync(1_000)
      expect(lower).toHaveBeenCalledExactlyOnceWith('original-pty', expect.any(Function))

      ownsPty = false
      await vi.advanceTimersByTimeAsync(60_000)
      expect(lower).toHaveBeenCalledTimes(1)
    }
  )

  it.skipIf(process.platform !== 'win32')(
    'rechecks an automation-owned PTY after its agent can spawn late tools',
    async () => {
      vi.useFakeTimers()
      const lower = vi.fn(async () => {})
      scheduleLocalAutomationPriorityFollowups('automation-pty', () => true, lower)

      await vi.advanceTimersByTimeAsync(70_000)
      expect(lower).toHaveBeenCalledTimes(4)
      expect(lower).toHaveBeenNthCalledWith(1, 'automation-pty', expect.any(Function))
      expect(lower).toHaveBeenNthCalledWith(2, 'automation-pty', expect.any(Function))
      expect(lower).toHaveBeenNthCalledWith(3, 'automation-pty', expect.any(Function))
      expect(lower).toHaveBeenNthCalledWith(4, 'automation-pty', expect.any(Function))
    }
  )

  it.skipIf(process.platform !== 'win32')(
    'does not overlap a slow process scan and keeps checking after a transient failure',
    async () => {
      vi.useFakeTimers()
      let finishFirst: (() => void) | undefined
      const lower = vi.fn()
      lower.mockImplementationOnce(() => new Promise<void>((resolve) => (finishFirst = resolve)))
      lower.mockRejectedValueOnce(new Error('temporary process table failure'))
      lower.mockResolvedValue(undefined)
      scheduleLocalAutomationPriorityFollowups('automation-pty', () => true, lower)

      await vi.advanceTimersByTimeAsync(70_000)
      expect(lower).toHaveBeenCalledTimes(1)
      finishFirst?.()
      await vi.advanceTimersByTimeAsync(30_000)
      expect(lower).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(30_000)
      expect(lower).toHaveBeenCalledTimes(3)
    }
  )

  it.skipIf(process.platform !== 'win32')(
    'stops after ownership is lost while a scan is in flight',
    async () => {
      vi.useFakeTimers()
      let ownsPty = true
      let finishScan: (() => void) | undefined
      const lower = vi.fn(() => new Promise<void>((resolve) => (finishScan = resolve)))
      scheduleLocalAutomationPriorityFollowups('automation-pty', () => ownsPty, lower)

      await vi.advanceTimersByTimeAsync(1_000)
      ownsPty = false
      finishScan?.()
      await vi.advanceTimersByTimeAsync(70_000)
      expect(lower).toHaveBeenCalledExactlyOnceWith('automation-pty', expect.any(Function))
    }
  )
})
