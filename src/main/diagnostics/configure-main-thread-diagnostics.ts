import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { BrowserWindow, powerMonitor } from 'electron'
import {
  isMainThreadDiagnosticsEnabled,
  recordSubprocessSpawn,
  setMainThreadDiagnosticLineWriter,
  setPersistentMainThreadDiagnosticsEnabled,
  startMainThreadChurnProbe
} from './main-thread-churn-probe'
import { createMainThreadFileCapture } from './main-thread-file-capture'
import { createTerminalLatencyFileCapture } from './terminal-latency-file-capture'
import { setSpawnObserver } from '../../shared/child-process/spawn-observer'
import { settledDiffCache } from '../git/source-control/git-read-cache-invalidation'
import { setTerminalLatencyCapture } from '../ipc/crash-reporting-renderer-breadcrumbs'
import { listRegisteredPtys } from '../memory/pty-registry'

function readMainThreadFocusContext(): {
  focusedWindowAtReport: boolean | null
  visibleWindowAtReport: boolean | null
  minimizedWindowAtReport: boolean | null
  windowCountAtReport: number | null
  systemIdleSecondsAtReport: number | null
} {
  let focusedWindowAtReport: boolean | null = null
  let visibleWindowAtReport: boolean | null = null
  let minimizedWindowAtReport: boolean | null = null
  let windowCountAtReport: number | null = null
  let systemIdleSecondsAtReport: number | null = null
  try {
    const windows = BrowserWindow.getAllWindows()
    windowCountAtReport = windows.length
    focusedWindowAtReport = BrowserWindow.getFocusedWindow() !== null
    visibleWindowAtReport = windows.some((window) => window.isVisible())
    minimizedWindowAtReport = windows.some((window) => window.isMinimized())
  } catch {
    // The probe can outlive window teardown. Unknown is safer than "background".
  }
  try {
    systemIdleSecondsAtReport = powerMonitor.getSystemIdleTime()
  } catch {
    // Some startup and shutdown states cannot read the system idle clock.
  }
  return {
    focusedWindowAtReport,
    visibleWindowAtReport,
    minimizedWindowAtReport,
    windowCountAtReport,
    systemIdleSecondsAtReport
  }
}

export function configureMainThreadDiagnostics(userDataPath: string): void {
  const diagnosticsDir = join(userDataPath, 'diagnostics')
  const persistentCapture = existsSync(join(diagnosticsDir, 'main-thread.enabled'))
  setPersistentMainThreadDiagnosticsEnabled(persistentCapture)
  const capture = persistentCapture || process.argv.includes('--orca-main-thread-diagnostics')
  const writeLine = capture
    ? createMainThreadFileCapture(join(diagnosticsDir, 'main-thread.jsonl'))
    : undefined
  setMainThreadDiagnosticLineWriter(writeLine)
  setTerminalLatencyCapture(
    capture
      ? createTerminalLatencyFileCapture(join(diagnosticsDir, 'terminal-latency.jsonl'))
      : undefined
  )
  if (isMainThreadDiagnosticsEnabled()) {
    setSpawnObserver(recordSubprocessSpawn)
  }
  startMainThreadChurnProbe({
    extraStats: () => ({
      diffCache: settledDiffCache.stats(),
      registeredLocalPtyCount: listRegisteredPtys().length,
      ...readMainThreadFocusContext()
    }),
    writeLine
  })
}
