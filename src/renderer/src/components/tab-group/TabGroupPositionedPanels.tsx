import { useCallback, useMemo, useState, type CSSProperties } from 'react'
import type { TabGroupLayoutNode } from '../../../../shared/tab-types'
import { useAppStore } from '@/store'
import type { WorkspaceLayoutNode } from '@/lib/workspace-split-layout'
import {
  WorkspaceSplitLayoutSlots,
  type WorkspacePaneRect
} from '../workspace-split/WorkspaceSplitLayoutSlots'
import { workspaceTouchesWindowEdge } from '../workspace-split/workspace-window-edges'
import TabGroupPanel from './TabGroupPanel'
import { useWorkspaceHeaderDrag } from '../workspace-split/use-workspace-header-drag'
import type { HoveredTabInsertion } from './useTabDragSplit'

const dragStripStyle: CSSProperties & { WebkitAppRegion: string } = { WebkitAppRegion: 'no-drag' }

export type PositionedGroup = WorkspacePaneRect & {
  topEdge: boolean
  leftEdge: boolean
  rightEdge: boolean
  bottomEdge: boolean
}

function slots(node: TabGroupLayoutNode): WorkspaceLayoutNode {
  return node.type === 'leaf'
    ? { type: 'leaf', workspaceId: node.groupId }
    : {
        type: 'split',
        direction: node.direction,
        ratio: node.ratio ?? 0.5,
        first: slots(node.first),
        second: slots(node.second)
      }
}

/** Stable group mounts keep editor buffers and terminal anchors intact across layout changes. */
export function TabGroupPositionedPanels({
  layout,
  worktreeId,
  focusedGroupId,
  isWorktreeActive,
  isWorktreeFocused,
  reserveLeftWindowChrome,
  reserveRightWindowChrome,
  isTabDragActive,
  hoveredTabInsertion,
  positions
}: {
  layout: TabGroupLayoutNode
  worktreeId: string
  focusedGroupId?: string
  isWorktreeActive: boolean
  isWorktreeFocused: boolean
  reserveLeftWindowChrome: boolean
  reserveRightWindowChrome: boolean
  isTabDragActive: boolean
  hoveredTabInsertion: HoveredTabInsertion | null
  positions?: ReadonlyMap<string, PositionedGroup>
}) {
  const dragGroup = useWorkspaceHeaderDrag(worktreeId)
  const localLayout = useMemo(() => slots(layout), [layout])
  const [localRects, setLocalRects] = useState(new Map<string, WorkspacePaneRect>())
  const onRatioChange = useCallback(
    (path: readonly ('first' | 'second')[], ratio: number) => {
      useAppStore.getState().setTabGroupSplitRatio(worktreeId, path.join('.'), ratio)
    },
    [worktreeId]
  )
  const onResizeStart = useCallback(
    () => useAppStore.getState().recordFeatureInteraction?.('terminal-panes'),
    []
  )
  const ids = (node: TabGroupLayoutNode): string[] =>
    node.type === 'leaf' ? [node.groupId] : [...ids(node.first), ...ids(node.second)]
  const groupIds = ids(layout)
  return (
    <>
      {!positions ? (
        <WorkspaceSplitLayoutSlots
          layout={localLayout}
          onRectsChange={setLocalRects}
          onRatioChange={onRatioChange}
          onResizeStart={onResizeStart}
          scope="tab-group"
        />
      ) : null}
      {groupIds.map((groupId) => {
        const positioned = positions?.get(groupId)
        const rect = positioned ?? (!positions ? localRects.get(groupId) : undefined)
        const touches = (edge: 'top' | 'bottom' | 'left' | 'right') =>
          positions
            ? (positioned?.[`${edge}Edge`] ?? false)
            : workspaceTouchesWindowEdge(localLayout, groupId, edge)
        return (
          <div
            key={groupId}
            data-workspace-pane-group-id={groupId}
            className="absolute flex flex-col min-w-0 min-h-0 overflow-hidden pointer-events-auto"
            style={
              rect
                ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
                : { visibility: 'hidden', width: 0, height: 0 }
            }
          >
            <div
              className="h-[4px] shrink-0 bg-card"
              data-terminal-focus-release-surface="true"
              data-workspace-drag-group-id={groupId}
              style={dragStripStyle}
              onPointerDown={dragGroup}
            />
            <TabGroupPanel
              groupId={groupId}
              worktreeId={worktreeId}
              isVisible={isWorktreeActive}
              isFocused={isWorktreeFocused && groupId === focusedGroupId}
              hasSplitGroups={groupIds.length > 1}
              touchesRightEdge={Boolean(touches('right'))}
              touchesLeftEdge={Boolean(touches('left'))}
              touchesBottomEdge={Boolean(touches('bottom'))}
              showWorkspacePaneCloseButton={Boolean(touches('top') && touches('right'))}
              reserveClosedExplorerToggleSpace={Boolean(
                reserveRightWindowChrome && touches('top') && touches('right')
              )}
              reserveCollapsedSidebarHeaderSpace={Boolean(
                reserveLeftWindowChrome && touches('top') && touches('left')
              )}
              isTabDragActive={isTabDragActive}
              hoveredTabInsertion={
                hoveredTabInsertion?.groupId === groupId ? hoveredTabInsertion : null
              }
            />
          </div>
        )
      })}
    </>
  )
}
