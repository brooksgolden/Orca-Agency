import type { WorkspaceStatusDefinition, Worktree } from '../../../../shared/worktree/types'
import { getWorkspaceStatus } from '../../../../shared/workspace-statuses'

const DONE_WORKSPACE_STATUS = 'completed'

/** Whether the Status view's left status control can move this workspace to Done. */
export function canMarkWorkspaceDone(
  worktree: Pick<Worktree, 'workspaceStatus'>,
  statuses: readonly WorkspaceStatusDefinition[]
): boolean {
  // Why: resolve the lane the row is actually shown in; a stale or unset id falls back to
  // the default lane, and a custom status list may have no Done lane at all.
  return (
    statuses.some((status) => status.id === DONE_WORKSPACE_STATUS) &&
    getWorkspaceStatus(worktree, statuses) !== DONE_WORKSPACE_STATUS
  )
}
