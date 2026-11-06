import type { ExecutionHostId } from '../../../../../../shared/execution-host'
import type { LastActiveCycleWorkspace } from '../../worktree-keyboard-cycle'

/** A held arrow previews its row as active before the workspace switch commits. */
export function withKeyboardPreview<
  P extends {
    activeWorktreeId: string | null
    activeWorkspaceExecutionHostId: ExecutionHostId | null
  }
>(props: P, preview: LastActiveCycleWorkspace | null): P {
  return preview
    ? {
        ...props,
        activeWorktreeId: preview.worktreeId,
        activeWorkspaceExecutionHostId: preview.executionHostId
      }
    : props
}
