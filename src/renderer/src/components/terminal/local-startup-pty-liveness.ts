import { parseAppSshPtyId } from '../../../../shared/ssh-pty-id'

const STARTUP_INVENTORY_TIMEOUT_MS = 1_500
let inventoryGeneration = 0
let savedLocalPtyLiveness: ReadonlyMap<string, boolean> | null = null
const spawnedSinceStartup = new Set<string>()

/** A saved PTY ID is only a reconnect hint. Absence from the local provider's
 * completed inventory proves the old process is gone; a failed inventory does not. */
export async function refreshLocalStartupPtyLiveness(
  savedPtyIds: readonly string[],
  listSessions: () => Promise<readonly { id: string }[]> = () =>
    window.api.pty.listSessions({ connectionId: null }),
  timeoutMs = STARTUP_INVENTORY_TIMEOUT_MS
): Promise<void> {
  const generation = ++inventoryGeneration
  savedLocalPtyLiveness = null
  const localIds = [...new Set(savedPtyIds)].filter(
    (id) => id.length > 0 && !id.startsWith('remote:') && !parseAppSshPtyId(id)
  )
  if (localIds.length === 0) {
    return
  }
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    const sessions = await Promise.race([
      listSessions(),
      new Promise<null>((resolve) => {
        timeout = setTimeout(() => resolve(null), timeoutMs)
      })
    ])
    if (generation !== inventoryGeneration || sessions === null) {
      return
    }
    const liveIds = new Set(sessions.map((session) => session.id))
    savedLocalPtyLiveness = new Map(
      localIds.map((id) => [id, liveIds.has(id) || spawnedSinceStartup.has(id)])
    )
  } catch {
    // An unavailable provider cannot certify that a saved process exited.
  } finally {
    clearTimeout(timeout)
  }
}

export function getLocalStartupPtyLiveness(ptyId: string): boolean | null {
  return savedLocalPtyLiveness?.get(ptyId) ?? null
}

/** Returns true only when a newly spawned local PTY overturns a saved dead verdict. */
export function noteLocalStartupPtySpawned(ptyId: string): boolean {
  if (!ptyId || ptyId.startsWith('remote:') || parseAppSshPtyId(ptyId)) {
    return false
  }
  if (savedLocalPtyLiveness?.has(ptyId) === false) {
    return false
  }
  spawnedSinceStartup.add(ptyId)
  const knownLiveness = savedLocalPtyLiveness
  if (!knownLiveness || knownLiveness.get(ptyId) !== false) {
    return false
  }
  savedLocalPtyLiveness = new Map(knownLiveness).set(ptyId, true)
  return true
}

export function findSavedPtyTabMounts(
  state: {
    tabsByWorktree: Readonly<Record<string, readonly { id: string; ptyId: string | null }[]>>
    ptyIdsByTabId: Readonly<Record<string, readonly string[]>>
    pendingReconnectPtyIdByTabId: Readonly<Record<string, string>>
    terminalLayoutsByTabId: Readonly<
      Record<string, { ptyIdsByLeafId?: Readonly<Record<string, string>> }>
    >
  },
  ptyId: string
): { worktreeId: string; tabIds: string[] }[] {
  const mounts: { worktreeId: string; tabIds: string[] }[] = []
  for (const [worktreeId, tabs] of Object.entries(state.tabsByWorktree)) {
    const tabIds = tabs
      .filter(
        (tab) =>
          tab.ptyId === ptyId ||
          state.ptyIdsByTabId[tab.id]?.includes(ptyId) ||
          state.pendingReconnectPtyIdByTabId[tab.id] === ptyId ||
          Object.values(state.terminalLayoutsByTabId[tab.id]?.ptyIdsByLeafId ?? {}).includes(ptyId)
      )
      .map((tab) => tab.id)
    if (tabIds.length > 0) {
      mounts.push({ worktreeId, tabIds })
    }
  }
  return mounts
}

export function savedTerminalTabHasNoLiveLocalPty(
  tab: { id: string; ptyId: string | null },
  state: {
    ptyIdsByTabId: Readonly<Record<string, readonly string[]>>
    terminalLayoutsByTabId: Readonly<
      Record<string, { ptyIdsByLeafId?: Readonly<Record<string, string>> }>
    >
  }
): boolean {
  const savedIds = [
    tab.ptyId,
    ...(state.ptyIdsByTabId[tab.id] ?? []),
    ...Object.values(state.terminalLayoutsByTabId[tab.id]?.ptyIdsByLeafId ?? {})
  ]
  return savedIds.every((id) => !id || getLocalStartupPtyLiveness(id) === false)
}

export function canDeferUnwatchedVisiblePartnerTab(
  executionHostId: string | null,
  tab: { id: string; ptyId: string | null },
  state: Parameters<typeof savedTerminalTabHasNoLiveLocalPty>[1]
): boolean {
  return executionHostId === 'local'
    ? savedTerminalTabHasNoLiveLocalPty(tab, state)
    : tab.ptyId === null && !state.ptyIdsByTabId[tab.id]?.length
}

export function clearLocalStartupPtyLiveness(): void {
  inventoryGeneration += 1
  savedLocalPtyLiveness = null
  spawnedSinceStartup.clear()
}
