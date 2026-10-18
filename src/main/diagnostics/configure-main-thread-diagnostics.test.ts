import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  probe: vi.fn(),
  observer: vi.fn(),
  capture: vi.fn(),
  latencyCapture: vi.fn(),
  setLatencyCapture: vi.fn(),
  record: vi.fn(),
  getFocusedWindow: vi.fn<() => object | null>(() => null),
  getAllWindows: vi.fn<() => { isVisible(): boolean; isMinimized(): boolean }[]>(() => []),
  getSystemIdleTime: vi.fn(() => 0),
  persistentEnabled: false,
  setLineWriter: vi.fn()
}))
vi.mock('electron', () => ({
  BrowserWindow: {
    getFocusedWindow: mocks.getFocusedWindow,
    getAllWindows: mocks.getAllWindows
  },
  powerMonitor: { getSystemIdleTime: mocks.getSystemIdleTime }
}))
vi.mock('./main-thread-churn-probe', () => ({
  setPersistentMainThreadDiagnosticsEnabled: (enabled: boolean) => {
    mocks.persistentEnabled = enabled
  },
  setMainThreadDiagnosticLineWriter: mocks.setLineWriter,
  isMainThreadDiagnosticsEnabled: () =>
    mocks.persistentEnabled ||
    process.env.ORCA_MAIN_THREAD_DIAGNOSTICS === '1' ||
    process.argv.includes('--orca-main-thread-diagnostics'),
  recordSubprocessSpawn: mocks.record,
  startMainThreadChurnProbe: mocks.probe
}))
vi.mock('./main-thread-file-capture', () => ({ createMainThreadFileCapture: mocks.capture }))
vi.mock('./terminal-latency-file-capture', () => ({
  createTerminalLatencyFileCapture: mocks.latencyCapture
}))
vi.mock('../ipc/crash-reporting-renderer-breadcrumbs', () => ({
  setTerminalLatencyCapture: mocks.setLatencyCapture
}))
vi.mock('../../shared/child-process/spawn-observer', () => ({ setSpawnObserver: mocks.observer }))
vi.mock('../git/source-control/git-read-cache-invalidation', () => ({
  settledDiffCache: { stats: () => ({ hits: 3 }) }
}))
import { configureMainThreadDiagnostics } from './configure-main-thread-diagnostics'

const originalArgv = process.argv
let temporaryProfile: string | null = null
afterEach(() => {
  process.argv = originalArgv
  if (temporaryProfile) {
    rmSync(temporaryProfile, { recursive: true, force: true })
    temporaryProfile = null
  }
  mocks.persistentEnabled = false
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

it('keeps file capture enabled after a normal relaunch when the profile marker exists', () => {
  temporaryProfile = mkdtempSync(join(tmpdir(), 'orca-main-thread-capture-'))
  const diagnosticsDir = join(temporaryProfile, 'diagnostics')
  mkdirSync(diagnosticsDir)
  writeFileSync(join(diagnosticsDir, 'main-thread.enabled'), '')
  process.argv = originalArgv.filter((x) => x !== '--orca-main-thread-diagnostics')
  vi.stubEnv('ORCA_MAIN_THREAD_DIAGNOSTICS', '')
  const sink = vi.fn()
  const latencySink = vi.fn()
  mocks.capture.mockReturnValue(sink)
  mocks.latencyCapture.mockReturnValue(latencySink)

  configureMainThreadDiagnostics(temporaryProfile)

  expect(process.env.ORCA_MAIN_THREAD_DIAGNOSTICS).toBe('')
  expect(mocks.capture).toHaveBeenCalledWith(join(diagnosticsDir, 'main-thread.jsonl'))
  expect(mocks.latencyCapture).toHaveBeenCalledWith(join(diagnosticsDir, 'terminal-latency.jsonl'))
  expect(mocks.setLineWriter).toHaveBeenCalledWith(sink)
  expect(mocks.observer).toHaveBeenCalledWith(mocks.record)
  expect(mocks.probe).toHaveBeenCalledWith(expect.objectContaining({ writeLine: sink }))
  expect(mocks.setLatencyCapture).toHaveBeenCalledWith(latencySink)
  mocks.getFocusedWindow.mockReturnValueOnce({})
  mocks.getAllWindows.mockReturnValueOnce([{ isVisible: () => true, isMinimized: () => false }])
  mocks.getSystemIdleTime.mockReturnValueOnce(42)
  const probeOptions = mocks.probe.mock.calls.at(-1)?.[0]
  expect(probeOptions?.extraStats()).toEqual({
    diffCache: { hits: 3 },
    focusedWindowAtReport: true,
    visibleWindowAtReport: true,
    minimizedWindowAtReport: false,
    windowCountAtReport: 1,
    systemIdleSecondsAtReport: 42
  })
  expect(probeOptions?.extraStats()).toEqual({
    diffCache: { hits: 3 },
    focusedWindowAtReport: false,
    visibleWindowAtReport: false,
    minimizedWindowAtReport: false,
    windowCountAtReport: 0,
    systemIdleSecondsAtReport: 0
  })
  mocks.getAllWindows.mockReturnValueOnce([{ isVisible: () => false, isMinimized: () => true }])
  expect(probeOptions?.extraStats()).toEqual({
    diffCache: { hits: 3 },
    focusedWindowAtReport: false,
    visibleWindowAtReport: false,
    minimizedWindowAtReport: true,
    windowCountAtReport: 1,
    systemIdleSecondsAtReport: 0
  })
  mocks.getAllWindows.mockImplementationOnce(() => {
    throw new Error('window teardown')
  })
  mocks.getSystemIdleTime.mockImplementationOnce(() => {
    throw new Error('idle clock unavailable')
  })
  expect(probeOptions?.extraStats()).toEqual({
    diffCache: { hits: 3 },
    focusedWindowAtReport: null,
    visibleWindowAtReport: null,
    minimizedWindowAtReport: null,
    windowCountAtReport: null,
    systemIdleSecondsAtReport: null
  })
})

it('enables automatic file capture from the explicit launch option', () => {
  process.argv = [...originalArgv, '--orca-main-thread-diagnostics']
  vi.stubEnv('ORCA_MAIN_THREAD_DIAGNOSTICS', '')
  const sink = vi.fn()
  const latencySink = vi.fn()
  mocks.capture.mockReturnValue(sink)
  mocks.latencyCapture.mockReturnValue(latencySink)
  configureMainThreadDiagnostics('/profile')
  expect(process.env.ORCA_MAIN_THREAD_DIAGNOSTICS).toBe('')
  expect(mocks.capture).toHaveBeenCalledWith(join('/profile', 'diagnostics', 'main-thread.jsonl'))
  expect(mocks.latencyCapture).toHaveBeenCalledWith(
    join('/profile', 'diagnostics', 'terminal-latency.jsonl')
  )
  expect(mocks.setLineWriter).toHaveBeenCalledWith(sink)
  expect(mocks.setLatencyCapture).toHaveBeenCalledWith(latencySink)
  expect(mocks.observer).toHaveBeenCalledWith(mocks.record)
  expect(mocks.probe).toHaveBeenCalledWith(expect.objectContaining({ writeLine: sink }))
})

it('preserves stderr capture for the existing environment variable', () => {
  process.argv = originalArgv.filter((x) => x !== '--orca-main-thread-diagnostics')
  vi.stubEnv('ORCA_MAIN_THREAD_DIAGNOSTICS', '1')
  configureMainThreadDiagnostics('/profile')
  expect(mocks.observer).toHaveBeenCalledWith(mocks.record)
  expect(mocks.capture).not.toHaveBeenCalled()
  expect(mocks.latencyCapture).not.toHaveBeenCalled()
  expect(mocks.setLatencyCapture).toHaveBeenCalledWith(undefined)
  expect(mocks.setLineWriter).toHaveBeenCalledWith(undefined)
  expect(mocks.probe).toHaveBeenCalledWith(expect.objectContaining({ writeLine: undefined }))
})

it('does not install the spawn observer or disk capture when diagnostics are disabled', () => {
  process.argv = originalArgv.filter((x) => x !== '--orca-main-thread-diagnostics')
  vi.stubEnv('ORCA_MAIN_THREAD_DIAGNOSTICS', '')
  configureMainThreadDiagnostics('/profile')
  expect(mocks.observer).not.toHaveBeenCalled()
  expect(mocks.capture).not.toHaveBeenCalled()
  expect(mocks.latencyCapture).not.toHaveBeenCalled()
  expect(mocks.setLatencyCapture).toHaveBeenCalledWith(undefined)
})
