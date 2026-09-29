import { isGeneratedWorktreeCreateName } from '../new-workspace/worktree-create-retry-policy'
import type { WorktreeMeta } from './meta-types'

export function folderDisplayNameMode(meta: Partial<WorktreeMeta>): 'fixed' | 'automatic' {
  if (meta.displayNameIsPinned !== undefined) {
    return meta.displayNameIsPinned ? 'fixed' : 'automatic'
  }
  if (meta.cliProvenance?.kind === 'created-by-cli') {
    return 'fixed'
  }
  // Why: older folder workspaces persisted random creature names without a provenance flag.
  return meta.displayName?.trim() && !isGeneratedWorktreeCreateName(meta.displayName)
    ? 'fixed'
    : 'automatic'
}
