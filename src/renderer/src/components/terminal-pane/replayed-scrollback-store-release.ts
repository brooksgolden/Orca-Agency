import {
  shouldPreserveTerminalScrollbackBuffers,
  type RepoConnection
} from '../../../../shared/workspace-session-terminal-buffers'

type ReplayedScrollbackReleaseArgs = {
  hasScrollbackRefs: boolean
  worktreeId: string | undefined
  repos: readonly RepoConnection[]
}

/** Keep the only saved copy until a later park replaces it; startup can remount before recapture. */
export function canReleaseReplayedScrollbackFromStore({
  hasScrollbackRefs,
  worktreeId,
  repos
}: ReplayedScrollbackReleaseArgs): boolean {
  // Local worktrees never recapture buffers at park, so retain their stored copy; refs reload from disk and remote/SSH worktrees recapture.
  return hasScrollbackRefs || shouldPreserveTerminalScrollbackBuffers(worktreeId, repos)
}
