/** Share minted-session parsing across main/renderer hydration and memory attribution; divergent copies caused REMOTE mislabels. */

import { parseWorkspaceKey } from './workspace-scope'

export const PTY_SESSION_ID_SEPARATOR = '@@'
export const WORKTREE_ID_SEPARATOR = '::'

/** Require @@ plus a valid Git/folder workspace identity; arbitrary UUIDs must not invent memory owners. Return null for unminted IDs. */
export function parsePtySessionId(sessionId: string): { worktreeId: string | null } {
  const idx = sessionId.lastIndexOf(PTY_SESSION_ID_SEPARATOR)
  if (idx <= 0) {
    return { worktreeId: null }
  }
  const candidate = sessionId.slice(0, idx)
  if (parseWorkspaceKey(candidate)?.type === 'folder') {
    return { worktreeId: candidate }
  }
  // Empty halves around :: must not invent owners for memory attribution.
  const sepIdx = candidate.indexOf(WORKTREE_ID_SEPARATOR)
  if (sepIdx <= 0 || sepIdx + WORKTREE_ID_SEPARATOR.length >= candidate.length) {
    return { worktreeId: null }
  }
  return { worktreeId: candidate }
}

type PtySessionOwnerRecord = { id: string; priorWorktreeIds?: readonly string[] }

/**
 * Ids a workspace's minted PTY sessions may carry: its own id plus earlier ids from an identity
 * migration (`WorktreeMeta.priorWorktreeIds`), because a live PTY keeps the id it was minted with.
 * Why the live filter: an earlier id that a live workspace now uses names that workspace's PTYs.
 */
export function ptySessionOwnerIds(
  worktreeId: string,
  worktreesByRepo: Readonly<Record<string, readonly PtySessionOwnerRecord[]>>
): string[] {
  const worktrees = Object.values(worktreesByRepo).flat()
  const liveIds = new Set(worktrees.map((worktree) => worktree.id))
  const candidates = worktrees.filter((worktree) => worktree.id === worktreeId)
  // Why: duplicated ids across host catalogs cannot safely lend either host's aliases.
  const priorIds = candidates.length === 1 ? (candidates[0].priorWorktreeIds ?? []) : []
  return [worktreeId, ...priorIds.filter((id) => id !== worktreeId && !liveIds.has(id))]
}

/** True when a minted session id's owner prefix is exactly one of `ownerIds`. */
export function isPtySessionMintedFor(sessionId: string, ownerIds: readonly string[]): boolean {
  const idx = sessionId.lastIndexOf(PTY_SESSION_ID_SEPARATOR)
  return idx > 0 && ownerIds.includes(sessionId.slice(0, idx))
}

/** False only for an id minted for another worktree; an id in no minted form names no owner. */
export function isPtySessionIdOwnedByWorktree(sessionId: string, worktreeId: string): boolean {
  const separatorIdx = sessionId.lastIndexOf(PTY_SESSION_ID_SEPARATOR)
  return separatorIdx === -1 || sessionId.slice(0, separatorIdx) === worktreeId
}
