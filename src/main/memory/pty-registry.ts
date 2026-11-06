// Only local PTYs belong here; remote PIDs cannot be sampled by this host.

import { readWindowsProcessCreationTime } from '../windows/windows-process-table'

export type PtyRegistration = {
  ptyId: string
  worktreeId: string | null
  sessionId: string | null
  paneKey: string | null
  // Capture at spawn to avoid IPC lookups; unavailable PIDs retain zero-attribution rows.
  pid: number | null
}

const registry = new Map<string, PtyRegistration>()
const registeredProcessStart = new Map<string, { pid: number; createdAtMs: number | null }>()

export function registerPty(entry: PtyRegistration): void {
  registry.set(entry.ptyId, entry)
  registeredProcessStart.set(entry.ptyId, {
    pid: entry.pid ?? 0,
    createdAtMs: entry.pid ? readWindowsProcessCreationTime(entry.pid) : null
  })
}

export function unregisterPty(ptyId: string): void {
  registry.delete(ptyId)
  registeredProcessStart.delete(ptyId)
}

/** Start time captured when this PTY registration was made, before its PID could be reused. */
export function getRegisteredPtyProcessStartTime(ptyId: string, pid: number): number | null {
  const captured = registeredProcessStart.get(ptyId)
  return captured?.pid === pid ? captured.createdAtMs : null
}

export function reassignRegisteredPtyWorkspace(ptyId: string, worktreeId: string): void {
  const entry = registry.get(ptyId)
  if (entry && entry.worktreeId !== worktreeId) {
    registry.set(ptyId, { ...entry, worktreeId })
  }
}

export function listRegisteredPtys(): PtyRegistration[] {
  return [...registry.values()]
}
