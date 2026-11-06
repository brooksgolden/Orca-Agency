// Coalesces preview detaches into one IPC per surface per frame: every
// hand-back main processes re-arms its global resize-suppression window (see
// the terminalPreview:detach handler), and a same-frame remount costs nothing.
type TerminalPreviewApi = typeof window.api.terminalPreview
type PendingDetach = { api: TerminalPreviewApi; surfaceIds: Set<string> }

const pending = new Map<string, PendingDetach>()
let flushTimer: ReturnType<typeof setTimeout> | null = null

function flush(): void {
  flushTimer = null
  if (pending.size === 0) {
    return
  }
  const localBySurface = new Map<string, string[]>()
  const remote: { api: TerminalPreviewApi; ptyId: string; surfaceId: string }[] = []
  for (const [ptyId, entry] of pending) {
    for (const surfaceId of entry.surfaceIds) {
      if (entry.api !== window.api.terminalPreview) {
        remote.push({ api: entry.api, ptyId, surfaceId })
        break
      }
      const ptyIds = localBySurface.get(surfaceId) ?? []
      ptyIds.push(ptyId)
      localBySurface.set(surfaceId, ptyIds)
    }
  }
  pending.clear()
  for (const [surfaceId, ptyIds] of localBySurface) {
    void window.api.terminalPreview.detach(ptyIds, surfaceId).catch(() => undefined)
  }
  for (const { api, ptyId, surfaceId } of remote) {
    void api.unsubscribe(ptyId, surfaceId).catch(() => undefined)
  }
}

/** Release this surface's stream and grid claim on the pty with the next batch. */
export function queuePreviewDetach(
  ptyId: string,
  surfaceId: string,
  api: TerminalPreviewApi = window.api.terminalPreview
): void {
  const entry = pending.get(ptyId) ?? { api, surfaceIds: new Set<string>() }
  entry.surfaceIds.add(surfaceId)
  pending.set(ptyId, entry)
  if (flushTimer === null) {
    // Why a macrotask, not a microtask: a remount lands in the same React
    // commit as the unmount, and its effect must run before the batch flushes.
    flushTimer = setTimeout(flush, 0)
  }
}

/**
 * A remount adopts one pending surface and its claim; sibling surfaces still detach.
 */
export function cancelPreviewDetach(ptyId: string): string | null {
  const entry = pending.get(ptyId)
  const surfaceId = entry?.surfaceIds.values().next().value ?? null
  if (surfaceId !== null) {
    entry?.surfaceIds.delete(surfaceId)
    if (entry?.surfaceIds.size === 0) {
      pending.delete(ptyId)
    }
  }
  return surfaceId
}
