import { useAppStore } from '@/store'
import { collectWorkspacePanes } from '@/lib/workspace-group-layout'
import { findWorkspaceSplitGroup } from '@/lib/workspace-split-layout'
import type { WorkspaceDropHover } from './useWorkspaceDropTargets'

/** Leave same-owner center joins and ordinary local splitting with the existing tab DnD. */
export function isLocalTabDrop(
  target: WorkspaceDropHover,
  sourceId: string,
  x: number,
  y: number
): boolean {
  if (target.id !== sourceId || target.wholeWindow || target.placement?.kind === 'quadrant') {
    return false
  }
  const split = findWorkspaceSplitGroup(useAppStore.getState().workspaceSplitGroups, sourceId)
  if (
    !split ||
    !collectWorkspacePanes(split.layout).some(
      (pane) => pane.workspaceId === sourceId && pane.groupId
    )
  ) {
    return true
  }
  const rect = target.groupBounds
  return Boolean(
    rect &&
    x > rect.left + rect.width * 0.25 &&
    x < rect.left + rect.width * 0.75 &&
    y > rect.top + rect.height * 0.25 &&
    y < rect.top + rect.height * 0.75
  )
}
