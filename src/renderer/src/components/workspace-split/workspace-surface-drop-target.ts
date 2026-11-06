import { useAppStore } from '@/store'
import { effectiveWorkspaceLayouts } from '@/lib/workspace-surface-state'
import { projectTabDrop } from '@/store/slices/tabs/tabs-drop-actions'
import { tabMovesWithinWindow } from './workspace-tab-edge-drop'
import {
  collectWorkspacePanes,
  workspacePaneKey,
  workspacePaneBounds,
  placeWorkspaceSurface
} from '@/lib/workspace-group-layout'
import { findWorkspaceSplitGroup } from '@/lib/workspace-split-layout'
import { workspacePaneDropTarget } from './workspace-pane-drop-target'
import type { WorkspaceDropHover } from './useWorkspaceDropTargets'

export function workspaceSurfaceDropTarget(
  root: HTMLElement,
  ids: ReadonlySet<string>,
  surface: HTMLElement,
  x: number,
  y: number,
  sourceId?: string,
  unifiedTabId?: string,
  sourceGroupId?: string
): WorkspaceDropHover {
  const hit = document
    .elementFromPoint(x, y)
    ?.closest<HTMLElement>('[data-workspace-pane-group-id]')
  const panel =
    hit && surface.contains(hit)
      ? hit
      : [...surface.querySelectorAll<HTMLElement>('[data-workspace-pane-group-id]')].find(
          (node) => {
            const bounds = node.getBoundingClientRect()
            return (
              bounds.width > 0 &&
              bounds.height > 0 &&
              x >= bounds.left &&
              x <= bounds.right &&
              y >= bounds.top &&
              y <= bounds.bottom
            )
          }
        )
  const state = useAppStore.getState()
  const workspaceId = surface.dataset.workspaceSurfaceId!
  const groupId = panel?.dataset.workspacePaneGroupId
  const sourceTab =
    sourceId && unifiedTabId
      ? state.unifiedTabsByWorktree[sourceId]?.find((tab) => tab.id === unifiedTabId)
      : undefined
  const sourceGroup = sourceGroupId ?? sourceTab?.groupId
  const ownsTab = Boolean(
    sourceTab &&
    sourceId &&
    tabMovesWithinWindow(state, sourceId, workspaceId, sourceTab.contentType)
  )
  const detaches = Boolean(
    sourceId &&
    sourceTab &&
    (ownsTab
      ? (state.groupsByWorktree[sourceId]?.find((group) => group.id === sourceGroup)?.tabOrder
          .length ?? 0) > 1
      : (state.tabsByWorktree[sourceId]?.length ?? 0) > 1)
  )
  const split = findWorkspaceSplitGroup(state.workspaceSplitGroups, workspaceId)
  const visible = split
    ? collectWorkspacePanes(split.layout)
    : [{ type: 'leaf' as const, workspaceId }]
  const paneCount = visible.reduce(
    (count, pane) =>
      count +
      (pane.groupId ? 1 : Math.max(1, state.groupsByWorktree[pane.workspaceId]?.length ?? 0)),
    0
  )
  const bounds = panel?.getBoundingClientRect() ?? surface.getBoundingClientRect()
  const canSwap = Boolean(
    sourceId &&
    ids.has(sourceId) &&
    !detaches &&
    (sourceGroup ||
      (sourceId !== workspaceId &&
        visible.filter((pane) => pane.workspaceId === sourceId).every((pane) => !pane.groupId))) &&
    workspacePaneKey({ type: 'leaf', workspaceId: sourceId, groupId: sourceGroup }) !==
      workspacePaneKey({ type: 'leaf', workspaceId, groupId })
  )
  const target = workspacePaneDropTarget(
    root.getBoundingClientRect(),
    bounds,
    x,
    y,
    paneCount + (!sourceId || !ids.has(sourceId) || detaches ? 1 : 0),
    canSwap
  )
  let working = state
  if (ownsTab && detaches && sourceId && sourceTab && sourceGroup) {
    const patch = projectTabDrop(
      state,
      sourceTab.id,
      { groupId: sourceGroup, splitDirection: 'right' },
      'drag:tab'
    )
    if (patch) {
      working = { ...state, ...patch }
    }
  }
  const source = {
    type: 'leaf' as const,
    workspaceId: !ownsTab && detaches ? `drag:${unifiedTabId}` : (sourceId ?? 'drag:workspace'),
    groupId: ownsTab || !sourceTab ? (detaches ? 'drag:tab' : sourceGroup) : undefined
  }
  const planned = placeWorkspaceSurface(
    state.workspaceSplitGroups,
    effectiveWorkspaceLayouts(working),
    source,
    { type: 'leaf', workspaceId, groupId },
    target.edge,
    'drag:preview',
    target.wholeWindow,
    target.placement
  )
  const plannedGroup = planned && findWorkspaceSplitGroup(planned, source.workspaceId)
  const plannedBounds =
    plannedGroup && workspacePaneBounds(plannedGroup.layout, workspacePaneKey(source))
  const rootBounds = root.getBoundingClientRect()
  return {
    id: workspaceId,
    blocked: !plannedBounds,
    ...target,
    targetGroupId: groupId,
    previewBounds: plannedBounds
      ? {
          left: rootBounds.left + plannedBounds.left * rootBounds.width,
          top: rootBounds.top + plannedBounds.top * rootBounds.height,
          width: plannedBounds.width * rootBounds.width,
          height: plannedBounds.height * rootBounds.height
        }
      : undefined,
    groupBounds: groupId
      ? { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height }
      : undefined
  }
}
