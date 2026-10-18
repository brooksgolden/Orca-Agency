import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  setPriority: vi.fn(),
  listRegisteredPtys: vi.fn(),
  getRegisteredPtyProcessStartTime: vi.fn(),
  isWindowsProcessStartTimeAvailable: vi.fn(),
  readWindowsProcessCreationTime: vi.fn(),
  readWindowsProcessIdentityTableFresh: vi.fn()
}))

vi.mock('node:os', () => ({
  constants: { priority: { PRIORITY_LOW: 10 } },
  setPriority: mocks.setPriority
}))
vi.mock('../memory/pty-registry', () => ({
  listRegisteredPtys: mocks.listRegisteredPtys,
  getRegisteredPtyProcessStartTime: mocks.getRegisteredPtyProcessStartTime
}))
vi.mock('../windows/windows-process-table', () => ({
  isWindowsProcessStartTimeAvailable: mocks.isWindowsProcessStartTimeAvailable,
  readWindowsProcessCreationTime: mocks.readWindowsProcessCreationTime,
  readWindowsProcessIdentityTableFresh: mocks.readWindowsProcessIdentityTableFresh
}))

import { lowerLocalAutomationProcessPriority } from './local-automation-process-priority'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.listRegisteredPtys.mockReturnValue([{ ptyId: 'automation-pty', pid: 100 }])
  mocks.getRegisteredPtyProcessStartTime.mockReturnValue(1_000)
  mocks.isWindowsProcessStartTimeAvailable.mockReturnValue(true)
  mocks.readWindowsProcessCreationTime.mockImplementation((pid: number) =>
    pid === 100 ? 1_000 : 2_000
  )
  mocks.readWindowsProcessIdentityTableFresh.mockResolvedValue([
    { pid: 100, ppid: 1, creationTimeMs: 1_000 },
    { pid: 101, ppid: 100, creationTimeMs: 2_000 }
  ])
})

describe.skipIf(process.platform !== 'win32')('verified local automation priority', () => {
  it('does not lower a reused terminal root PID', async () => {
    mocks.readWindowsProcessCreationTime.mockReturnValue(3_000)

    await lowerLocalAutomationProcessPriority('automation-pty')

    expect(mocks.setPriority).not.toHaveBeenCalled()
  })

  it('skips a child PID reused after the process snapshot', async () => {
    mocks.readWindowsProcessCreationTime.mockImplementation((pid: number) =>
      pid === 100 ? 1_000 : 3_000
    )

    await lowerLocalAutomationProcessPriority('automation-pty')

    expect(mocks.setPriority).toHaveBeenCalledExactlyOnceWith(100, 10)
  })

  it('does not lower any process without native start times', async () => {
    mocks.isWindowsProcessStartTimeAvailable.mockReturnValue(false)

    await lowerLocalAutomationProcessPriority('automation-pty')

    expect(mocks.setPriority).not.toHaveBeenCalled()
    expect(mocks.readWindowsProcessIdentityTableFresh).not.toHaveBeenCalled()
  })
})
