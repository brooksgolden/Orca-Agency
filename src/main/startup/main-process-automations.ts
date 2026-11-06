import type { AutomationService } from '../automations/service'
import { createRuntimeAutomationService } from '../automations/runtime-automation-service'
import { app, powerMonitor } from 'electron'
import { freemem, totalmem } from 'node:os'
import { mainProcessState as state } from './main-process-state'
import { runAgentSpawnBacklogMigration } from '../automations/agent-spawn-backlog-migration'

const GIB = 1024 ** 3

export function localScheduleFreeMemoryFloor(
  totalBytes: number,
  platform: NodeJS.Platform
): number {
  if (platform !== 'win32' && platform !== 'linux') {
    // macOS raw free pages undercount reclaimable memory.
    return 0
  }
  const cap = platform === 'win32' ? 6 * GIB : 4 * GIB
  return Math.min(cap, Math.max(2 * GIB, Math.floor(totalBytes / 4)))
}

export function initializeMainProcessAutomations(): AutomationService {
  const store = state.store
  const runtime = state.runtime
  const claudeUsage = state.claudeUsage
  const codexUsage = state.codexUsage
  if (!store || !runtime || !claudeUsage || !codexUsage) {
    throw new Error('Runtime and usage stores must be initialized before automations')
  }
  const service = createRuntimeAutomationService({
    store,
    runtime,
    claudeUsage,
    codexUsage,
    // Why: desktop clients mirror remote-host automations, but only a server process should execute remote_host_service-owned schedules.
    // Remote clients mirror schedules; only server processes execute remote_host_service ownership.
    headless: state.isServeMode,
    dispatchHeadlessly: true,
    // Scheduled agents wait for a quiet laptop. Explicit Run now still starts immediately.
    ...(!state.isServeMode
      ? {
          localScheduleReady: () =>
            powerMonitor.getSystemIdleTime() >= 600 &&
            freemem() >= localScheduleFreeMemoryFloor(totalmem(), process.platform) &&
            !runtime.hasMobileTerminalSubscribers(),
          localSchedulePrecheckMayContinue: () =>
            powerMonitor.getSystemIdleTime() >= 600 && !runtime.hasMobileTerminalSubscribers()
        }
      : {})
  })
  state.automations = service
  return service
}

export function runDeferredAgentSpawnBacklogMigration(): void {
  const store = state.store
  if (!store) {
    throw new Error('Store must be initialized before migrating agent-spawn provenance')
  }
  void runAgentSpawnBacklogMigration(store, app.getPath('userData')).catch((error) => {
    console.warn('[chat-sidebar] agent-spawn backlog migration failed:', error)
  })
}
