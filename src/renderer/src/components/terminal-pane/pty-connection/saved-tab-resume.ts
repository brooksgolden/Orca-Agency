import type { AppState } from '@/store'
import { getKnownExecutionHostIdForWorktree } from '@/lib/worktree-runtime-owner'
import type { ExecutionHostId } from '../../../../../shared/execution-host'
import type { AiVaultSessionTitle } from '../../../../../shared/ai-vault-session-title'

/** A tab title identifies one conversation, never every leaf of a split terminal. */
export function savedTabResume(
  state: Pick<
    AppState,
    | 'tabsByWorktree'
    | 'terminalLayoutsByTabId'
    | 'settings'
    | 'repos'
    | 'worktreesByRepo'
    | 'folderWorkspaces'
    | 'projectGroups'
    | 'projects'
  >,
  worktreeId: string,
  tabId: string,
  executionHostId: ExecutionHostId | null | undefined
) {
  const tab = state.tabsByWorktree[worktreeId]?.find((candidate) => candidate.id === tabId)
  const identity: AiVaultSessionTitle | null | undefined = tab?.aiVaultTitle
  if (!identity?.sessionId || state.terminalLayoutsByTabId?.[tabId]?.root?.type === 'split') {
    return null
  }
  const hostId = executionHostId ?? getKnownExecutionHostIdForWorktree(state, worktreeId)
  if (!hostId) {
    return null
  }
  const key = JSON.stringify([hostId, identity.agent, identity.sessionId])
  const snapshot = state.settings?.chatSidebar?.sessions?.[key]?.snapshot
  if (
    !snapshot ||
    snapshot.executionHostId !== hostId ||
    snapshot.agent !== identity.agent ||
    snapshot.sessionId !== identity.sessionId
  ) {
    return null
  }
  return snapshot
}
