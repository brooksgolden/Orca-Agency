import type { TabGroupLayoutNode } from '../../../../shared/tab-types'
import { TabGroupPositionedPanels, type PositionedGroup } from './TabGroupPositionedPanels'
import { WorkspaceTabDragLayer } from './WorkspaceTabDragLayer'

/** Compose main-window chrome around the shared drag scope/tree; other hosts supply their own chrome. */
export default function TabGroupSplitLayout({
  layout,
  positions,
  worktreeId,
  focusedGroupId,
  isWorktreeActive,
  isWorktreeFocused = isWorktreeActive,
  reserveLeftWindowChrome = true,
  reserveRightWindowChrome = true
}: {
  layout: TabGroupLayoutNode
  positions?: ReadonlyMap<string, PositionedGroup>
  worktreeId: string
  focusedGroupId?: string
  isWorktreeActive: boolean
  isWorktreeFocused?: boolean
  reserveLeftWindowChrome?: boolean
  reserveRightWindowChrome?: boolean
}): React.JSX.Element {
  return (
    <WorkspaceTabDragLayer worktreeId={worktreeId} enabled={isWorktreeFocused}>
      {({ isTabDragActive, hoveredTabInsertion, setDragRootNode }) => (
        // Group panels retain their mounts while their measured slots move.
        <div
          ref={setDragRootNode}
          className="relative flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden pointer-events-none"
        >
          <div className="relative flex flex-1 min-w-0 min-h-0 overflow-hidden">
            <TabGroupPositionedPanels
              positions={positions}
              layout={layout}
              worktreeId={worktreeId}
              focusedGroupId={focusedGroupId}
              isWorktreeActive={isWorktreeActive}
              isWorktreeFocused={isWorktreeFocused}
              reserveLeftWindowChrome={reserveLeftWindowChrome}
              reserveRightWindowChrome={reserveRightWindowChrome}
              isTabDragActive={isTabDragActive}
              hoveredTabInsertion={hoveredTabInsertion}
            />
          </div>
        </div>
      )}
    </WorkspaceTabDragLayer>
  )
}
