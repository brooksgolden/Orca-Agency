import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const nativePlatform = process.platform

const fixture = vi.hoisted(() => ({
  idleSeconds: vi.fn(),
  freeBytes: vi.fn(),
  totalBytes: vi.fn(),
  createService: vi.fn(
    (options: {
      localScheduleReady?: () => boolean
      localSchedulePrecheckMayContinue?: () => boolean
    }) => options
  ),
  state: {
    store: {},
    runtime: { hasMobileTerminalSubscribers: vi.fn() },
    claudeUsage: {},
    codexUsage: {},
    isServeMode: false,
    automations: null
  }
}))

vi.mock('electron', () => ({ powerMonitor: { getSystemIdleTime: fixture.idleSeconds } }))
vi.mock('node:os', () => ({ freemem: fixture.freeBytes, totalmem: fixture.totalBytes }))
vi.mock('../automations/runtime-automation-service', () => ({
  createRuntimeAutomationService: fixture.createService
}))
vi.mock('./main-process-state', () => ({ mainProcessState: fixture.state }))

import {
  initializeMainProcessAutomations,
  localScheduleFreeMemoryFloor
} from './main-process-automations'

describe('local scheduled automation admission', () => {
  beforeEach(() => {
    fixture.createService.mockClear()
    fixture.idleSeconds.mockReturnValue(900)
    fixture.freeBytes.mockReturnValue(8 * 1024 ** 3)
    fixture.totalBytes.mockReturnValue(32 * 1024 ** 3)
    fixture.state.runtime.hasMobileTerminalSubscribers.mockReturnValue(false)
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', { configurable: true, value: nativePlatform })
  })

  it('defers new scheduled runs while a phone terminal is open', () => {
    initializeMainProcessAutomations()
    const ready = fixture.createService.mock.calls[0]?.[0].localScheduleReady

    expect(ready?.()).toBe(true)
    fixture.state.runtime.hasMobileTerminalSubscribers.mockReturnValue(true)
    expect(ready?.()).toBe(false)
  })

  it('holds a Windows scheduled run under the memory floor without cancelling its precheck', () => {
    Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })
    const floor = localScheduleFreeMemoryFloor(32 * 1024 ** 3, 'win32')
    fixture.freeBytes.mockReturnValue(floor - 1)
    initializeMainProcessAutomations()
    const ready = fixture.createService.mock.calls[0]?.[0].localScheduleReady
    const precheckMayContinue =
      fixture.createService.mock.calls[0]?.[0].localSchedulePrecheckMayContinue

    expect(ready?.()).toBe(false)
    expect(precheckMayContinue?.()).toBe(true)
    fixture.freeBytes.mockReturnValue(floor)
    expect(ready?.()).toBe(true)
    fixture.idleSeconds.mockReturnValue(0)
    expect(precheckMayContinue?.()).toBe(false)
  })

  it('allows a Mac scheduled run when reclaimable memory is not in raw free pages', () => {
    Object.defineProperty(process, 'platform', { configurable: true, value: 'darwin' })
    fixture.freeBytes.mockReturnValue(512 * 1024 ** 2)
    initializeMainProcessAutomations()
    const ready = fixture.createService.mock.calls[0]?.[0].localScheduleReady

    expect(ready?.()).toBe(true)
  })

  it('scales the Windows floor without starving other platforms on raw free pages', () => {
    expect(localScheduleFreeMemoryFloor(8 * 1024 ** 3, 'win32')).toBe(2 * 1024 ** 3)
    expect(localScheduleFreeMemoryFloor(16 * 1024 ** 3, 'win32')).toBe(4 * 1024 ** 3)
    expect(localScheduleFreeMemoryFloor(32 * 1024 ** 3, 'win32')).toBe(6 * 1024 ** 3)
    expect(localScheduleFreeMemoryFloor(4 * 1024 ** 3, 'darwin')).toBe(0)
    expect(localScheduleFreeMemoryFloor(4 * 1024 ** 3, 'linux')).toBe(2 * 1024 ** 3)
    expect(localScheduleFreeMemoryFloor(32 * 1024 ** 3, 'linux')).toBe(4 * 1024 ** 3)
  })
})
