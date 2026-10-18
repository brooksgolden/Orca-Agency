/**
 * Lightweight side-table that lets the memory collector attribute PTY
 * processes back to the worktree that spawned them.
 *
 * Why a separate module rather than folding it into pty.ts: the PTY
 * subsystem has no other reason to know about worktree memory. Keeping
 * the registry here means the collector can evolve (e.g. start tracking
 * extra per-session metadata) without touching the critical-path spawn
 * handler. The write-side is just two calls — `register` on spawn,
 * `unregister` on teardown.
 *
 * Scope: local PTYs only. SSH-backed PTYs execute on a remote host, so
 * their memory does not contribute to Orca's process footprint and
 * cannot be queried with our local `ps` tree.
 */

import { readWindowsProcessCreationTime } from '../windows/windows-process-table'

export type PtyRegistration = {
  ptyId: string
  worktreeId: string | null
  sessionId: string | null
  paneKey: string | null
  // Why number | null: captured at spawn time so the collector does not have
  // to reach back into the IPC module on every snapshot to resolve it. It is
  // nullable because node-pty can return a process whose pid is briefly
  // unavailable (spawn succeeded but the OS hasn't published the pid yet);
  // storing null lets the collector render a zero-attribution row for that
  // PTY instead of throwing and dropping the whole snapshot.
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

/** Snapshot of currently-registered local PTYs for the collector to walk. */
export function listRegisteredPtys(): PtyRegistration[] {
  return [...registry.values()]
}
