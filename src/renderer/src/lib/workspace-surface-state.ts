import type { AppState } from '@/store/types'
import type { TabGroupLayoutNode } from '../../../shared/tab-types'
import { getEffectiveLayoutForWorktree } from '@/components/terminal/split-group-mount'

/** Match the mounted renderer, including workspaces with a synthetic single-group layout. */
export function effectiveWorkspaceLayouts(
  state: Pick<AppState, 'layoutByWorktree' | 'groupsByWorktree' | 'activeGroupIdByWorktree'>
): Record<string, TabGroupLayoutNode> {
  const layouts = { ...state.layoutByWorktree }
  for (const id of Object.keys(state.groupsByWorktree)) {
    const layout = getEffectiveLayoutForWorktree(
      id,
      state.layoutByWorktree,
      state.groupsByWorktree,
      state.activeGroupIdByWorktree
    )
    if (layout) {
      layouts[id] = layout
    }
  }
  return layouts
}
