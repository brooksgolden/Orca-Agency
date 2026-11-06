import { useAppStore } from '@/store'
import { TERMINAL_PAIRED_PARKING_RUNTIME_CAPABILITY } from '../../../../../shared/protocol-version'
import { getRemoteRuntimePtyEnvironmentId } from '@/runtime/runtime-terminal-stream'
import {
  isRuntimeHostContactRevoked,
  lastVerifiedRuntimeStatus
} from '../../../../../shared/runtime-host-status'
import {
  isPtySessionMintedFor,
  PTY_SESSION_ID_SEPARATOR
} from '../../../../../shared/pty-session-id-format'

export function canRestorePairedParkedTerminal(ptyId: string): boolean {
  const environmentId = getRemoteRuntimePtyEnvironmentId(ptyId)
  if (environmentId === null) {
    return false
  }
  // Retain last-verified capability across contact loss so reattach cannot cold-resume a duplicate (docs/reference/ssh-execution-boundary.md).
  const entry = useAppStore.getState().runtimeStatusByEnvironmentId.get(environmentId)
  if (isRuntimeHostContactRevoked(entry)) {
    return false
  }
  const status = lastVerifiedRuntimeStatus(entry)
  return status?.capabilities?.includes(TERMINAL_PAIRED_PARKING_RUNTIME_CAPABILITY) === true
}

// Why: daemon session IDs use the format `${worktreeId}@@${shortUuid}`.
// This validates that a session ID actually belongs to the given worktree,
// preventing cross-workspace contamination during restore. `ownerIds` comes from
// ptySessionOwnerIds, so a migrated workspace still owns PTYs minted under its prior id.
export function isSessionOwnedByWorktree(sessionId: string, ownerIds: readonly string[]): boolean {
  if (sessionId.lastIndexOf(PTY_SESSION_ID_SEPARATOR) === -1) {
    return true
  }
  return isPtySessionMintedFor(sessionId, ownerIds)
}
