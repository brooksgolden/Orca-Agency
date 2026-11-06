import { useEffect, useMemo } from 'react'
import { useAppStore } from '@/store'
import { createTerminalProviderSnapshotBoundPtyIdsSelector } from './terminal-provider-snapshot-bound-pty-ids'
import { startTerminalProviderSnapshotCapabilitySynchronization } from './terminal-provider-snapshot-capability'
import { useTerminalProviderSnapshotCapabilityRevision } from './use-terminal-provider-snapshot-capability-revision'

export function useTerminalProviderSnapshotCapability(enabled: boolean): number {
  // Match startup’s full PTY set or synchronization prunes valid split/reconnect answers; the stable selector avoids scans/restarts on title or focus writes.
  const selectBoundPtyIds = useMemo(() => createTerminalProviderSnapshotBoundPtyIdsSelector(), [])
  const boundPtyIds = useAppStore(selectBoundPtyIds)
  const capabilityRevision = useTerminalProviderSnapshotCapabilityRevision()

  useEffect(() => {
    // Why: hydration exposes restored PTY ids before activation unlocks; prefetching here preserves cold deferral without blocking render.
    if (!enabled && boundPtyIds.length === 0) {
      return
    }
    return startTerminalProviderSnapshotCapabilitySynchronization(boundPtyIds)
  }, [boundPtyIds, enabled])

  return capabilityRevision
}
