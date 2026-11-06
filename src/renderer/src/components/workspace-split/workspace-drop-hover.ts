import type { WorkspaceSplitEdge } from '@/lib/workspace-split-layout'
import type { WorkspacePanePlacement } from '@/lib/workspace-pane-placement'
import type { WorkspaceTabStripDrop } from './workspace-tab-strip-drop'

export type WorkspaceDropHover = {
  id: string
  edge: WorkspaceSplitEdge
  wholeWindow: boolean
  placement?: WorkspacePanePlacement
  targetGroupId?: string
  groupBounds?: { left: number; top: number; width: number; height: number }
  previewBounds?: { left: number; top: number; width: number; height: number }
  blocked?: boolean
  strip?: WorkspaceTabStripDrop
}
