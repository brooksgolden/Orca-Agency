import { constants, setPriority } from 'node:os'
import { getRegisteredPtyProcessStartTime, listRegisteredPtys } from '../memory/pty-registry'
import {
  isWindowsProcessStartTimeAvailable,
  readWindowsProcessCreationTime,
  readWindowsProcessIdentityTableFresh
} from '../windows/windows-process-table'
import type { WindowsProcessIdentityRow } from '../windows/windows-process-table'

export function automationProcessTreePids(
  rootPid: number,
  rootCreatedAtMs: number,
  rows: readonly Pick<WindowsProcessIdentityRow, 'pid' | 'ppid' | 'creationTimeMs'>[]
): number[] {
  const byPid = new Map(rows.map((row) => [row.pid, row]))
  if (byPid.get(rootPid)?.creationTimeMs !== rootCreatedAtMs) {
    return []
  }
  const children = new Map<number, number[]>()
  for (const row of rows) {
    const siblings = children.get(row.ppid) ?? []
    const parentCreatedAtMs = byPid.get(row.ppid)?.creationTimeMs
    if (
      typeof row.creationTimeMs !== 'number' ||
      typeof parentCreatedAtMs !== 'number' ||
      row.creationTimeMs < parentCreatedAtMs
    ) {
      continue
    }
    siblings.push(row.pid)
    children.set(row.ppid, siblings)
  }
  const pending = [...(children.get(rootPid) ?? [])]
  const visited = new Set<number>([rootPid])
  const descendants: number[] = []
  while (pending.length) {
    const pid = pending.pop()
    if (pid === undefined || visited.has(pid)) {
      continue
    }
    visited.add(pid)
    descendants.push(pid)
    pending.push(...(children.get(pid) ?? []))
  }
  return descendants
}

/** Keep automation terminal work behind interactive Windows work, including spawned tools. */
export async function lowerLocalAutomationProcessPriority(
  ptyId: string | null,
  stillOwnsPty?: () => boolean
): Promise<void> {
  if (process.platform !== 'win32' || !ptyId) {
    return
  }
  const ownsPty = (): boolean => {
    try {
      return stillOwnsPty?.() !== false
    } catch {
      return false
    }
  }
  if (!ownsPty()) {
    return
  }
  const rootPid = listRegisteredPtys().find((pty) => pty.ptyId === ptyId)?.pid
  if (!rootPid) {
    return
  }
  // PID-only ancestry is unsafe: a child keeps its former parent's PID after
  // exit, and Windows can recycle that PID for an unrelated Orca process.
  if (!isWindowsProcessStartTimeAvailable()) {
    return
  }
  const rootCreatedAtMs = getRegisteredPtyProcessStartTime(ptyId, rootPid)
  if (rootCreatedAtMs === null) {
    return
  }
  const lower = (pid: number, createdAtMs: number): void => {
    if (readWindowsProcessCreationTime(pid) !== createdAtMs) {
      return
    }
    try {
      setPriority(pid, constants.priority.PRIORITY_LOW)
    } catch {
      // A process can exit between the snapshot and the priority change.
    }
  }
  lower(rootPid, rootCreatedAtMs)
  try {
    const rows = await readWindowsProcessIdentityTableFresh()
    if (!ownsPty()) {
      return
    }
    const createdAtByPid = new Map(rows.map((row) => [row.pid, row.creationTimeMs]))
    for (const pid of automationProcessTreePids(rootPid, rootCreatedAtMs, rows)) {
      const createdAtMs = createdAtByPid.get(pid)
      if (typeof createdAtMs === 'number') {
        lower(pid, createdAtMs)
      }
    }
  } catch {
    // The proven terminal root still runs at low priority if process inventory is unavailable.
  }
}

const ACTIVE_AUTOMATION_PRIORITY_RECHECK_MS = 30_000

/** Retry missed scans and re-lower tools that reset their priority while the run owns its PTY. */
export function scheduleLocalAutomationPriorityFollowups(
  ptyId: string | null,
  stillOwnsPty: () => boolean,
  lower: (
    id: string,
    stillOwnsPty?: () => boolean
  ) => Promise<void> = lowerLocalAutomationProcessPriority
): void {
  if (process.platform !== 'win32' || !ptyId) {
    return
  }
  let scanInFlight = false
  const schedule = (delayMs: number, nextDelayMs: number): void => {
    const timer = setTimeout(async () => {
      try {
        if (!stillOwnsPty()) {
          return
        }
        schedule(nextDelayMs, ACTIVE_AUTOMATION_PRIORITY_RECHECK_MS)
        if (scanInFlight) {
          return
        }
        scanInFlight = true
        try {
          await lower(ptyId, stillOwnsPty)
        } catch {
          // Retry a transient process-table failure on the next interval.
        } finally {
          scanInFlight = false
        }
      } catch {
        // The run or runtime may close during a scan.
      }
    }, delayMs)
    timer.unref()
  }
  schedule(1_000, 9_000)
}
