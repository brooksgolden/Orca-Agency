import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  isMainThreadDiagnosticsEnabled,
  recordSubprocessSpawn,
  setMainThreadDiagnosticLineWriter,
  setPersistentMainThreadDiagnosticsEnabled,
  startMainThreadChurnProbe
} from './main-thread-churn-probe'
import { createMainThreadFileCapture } from './main-thread-file-capture'
import { setSpawnObserver } from '../../shared/child-process/spawn-observer'
import { settledDiffCache } from '../git/source-control/git-read-cache-invalidation'

export function configureMainThreadDiagnostics(userDataPath: string): void {
  const diagnosticsDir = join(userDataPath, 'diagnostics')
  const persistentCapture = existsSync(join(diagnosticsDir, 'main-thread.enabled'))
  setPersistentMainThreadDiagnosticsEnabled(persistentCapture)
  const capture = persistentCapture || process.argv.includes('--orca-main-thread-diagnostics')
  const writeLine = capture
    ? createMainThreadFileCapture(join(diagnosticsDir, 'main-thread.jsonl'))
    : undefined
  setMainThreadDiagnosticLineWriter(writeLine)
  if (isMainThreadDiagnosticsEnabled()) {
    setSpawnObserver(recordSubprocessSpawn)
  }
  startMainThreadChurnProbe({
    extraStats: () => ({ diffCache: settledDiffCache.stats() }),
    writeLine
  })
}
