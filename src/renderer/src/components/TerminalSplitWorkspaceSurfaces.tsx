import { useAnyBrowserGuestNeedsPaint } from './browser-pane/host-guest/browser-guest-paint-retention'
import { WorktreeSplitSurface } from './TerminalWorktreeSplitSurface'
import { selectParkedEquivalentMountTabIds } from './terminal/startup-terminal-tab-hold'
import type { TerminalController } from './use-terminal-controller'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '@/store'
import {
  collectWorkspaceIds,
  findWorkspaceSplitGroup,
  MAX_WORKSPACE_PANES,
  type WorkspaceSplitEdge
} from '@/lib/workspace-split-layout'
import { readWorkspaceDragData, WORKSPACE_STATUS_DRAG_TYPE } from './sidebar/workspace-status'
import { activateAndRevealWorkspace } from '@/lib/worktree-activation'
import { toast } from 'sonner'
import {
  WorkspaceSplitLayoutSlots,
  type WorkspacePaneRect
} from './workspace-split/WorkspaceSplitLayoutSlots'
import {
  WORKSPACE_PANE_POINTER_CLEAR,
  WORKSPACE_PANE_POINTER_DROP,
  WORKSPACE_PANE_POINTER_MOVE,
  readWorkspacePanePointerDetail
} from './workspace-split/workspace-pane-pointer-drag'
import { workspaceDropTarget } from './workspace-split/workspace-drop-target'
import { WorkspaceDropPreview } from './workspace-split/WorkspaceDropPreview'

export function TerminalSplitWorkspaceSurfaces({
  controller
}: {
  controller: TerminalController
}): React.JSX.Element | null {
  const {
    activationDeferredMountTabIdsByWorktreeRef,
    activeGroupIdByWorktree,
    activeView,
    activityTerminalPortals,
    anyMountedWorktreeHasLayout,
    backgroundMountTabIdsByWorktreeRef,
    effectiveActiveLayout,
    effectiveParkedTerminalWorktreeIds,
    forceParkedTerminalWorktreeIds,
    getEffectiveLayoutForWorktree,
    measurableBackgroundWorktreeIdsRef,
    mountedWorktreeIdsRef,
    renderedActiveWorktreeId,
    visibleWorkspaceSplitGroup,
    startupTerminalTabHold,
    workspaceSurfaces
  } = controller
  const rootRef = useRef<HTMLDivElement>(null)
  const [paneRects, setPaneRects] = useState<Map<string, WorkspacePaneRect>>(() => new Map())
  const [hover, setHover] = useState<{
    id: string
    edge: WorkspaceSplitEdge
    wholeWindow: boolean
  } | null>(null)
  const onRatioChange = useCallback(
    (path: readonly ('first' | 'second')[], ratio: number) => {
      if (visibleWorkspaceSplitGroup) {
        useAppStore.getState().setWorkspaceSplitRatio(visibleWorkspaceSplitGroup.id, path, ratio)
      }
    },
    [visibleWorkspaceSplitGroup]
  )
  // Why: this and TerminalSurface are both strict ancestors of every browser <webview>, so a
  // remote controller needs each to drop `hidden` — the per-worktree surface hatch below cannot
  // override an ancestor that stopped compositing.
  const retainBrowserGuestPaint = useAnyBrowserGuestNeedsPaint(!effectiveActiveLayout)
  const mountedSurfaces = workspaceSurfaces.filter((workspace) =>
    mountedWorktreeIdsRef.current.has(workspace.id)
  )
  const group =
    activeView === 'terminal' &&
    visibleWorkspaceSplitGroup &&
    collectWorkspaceIds(visibleWorkspaceSplitGroup.layout).every((id) =>
      mountedSurfaces.some((workspace) => workspace.id === id)
    )
      ? visibleWorkspaceSplitGroup
      : null
  const visibleIds =
    activeView === 'terminal'
      ? group
        ? collectWorkspaceIds(group.layout)
        : renderedActiveWorktreeId
          ? [renderedActiveWorktreeId]
          : []
      : []
  const visibleIdsKey = visibleIds.join('\u0000')
  // Why: the root below mounts only once a layout exists. Keying the listener effect on
  // it re-attaches drop handling when the root appears after the visible ids settled.
  const rendersRoot = anyMountedWorktreeHasLayout || group !== null
  useEffect(() => {
    const root = rootRef.current
    if (!root) {
      return
    }
    const ids = new Set(visibleIdsKey.split('\u0000').filter(Boolean))
    const dropTarget = (surface: HTMLElement, x: number, y: number) => ({
      id: surface.dataset.workspaceSurfaceId!,
      ...workspaceDropTarget(
        root.getBoundingClientRect(),
        surface.getBoundingClientRect(),
        x,
        y,
        ids.size > 1
      )
    })
    const targetSurface = (event: DragEvent): HTMLElement | null => {
      if (!Array.from(event.dataTransfer?.types ?? []).includes(WORKSPACE_STATUS_DRAG_TYPE)) {
        return null
      }
      const element = event.target instanceof Element ? event.target : null
      const surface = element?.closest<HTMLElement>('[data-workspace-surface-id]')
      return surface && root.contains(surface) && ids.has(surface.dataset.workspaceSurfaceId ?? '')
        ? surface
        : null
    }
    const pointerSurface = (x: number, y: number): HTMLElement | null => {
      const element = document.elementFromPoint(x, y)
      const surface = element?.closest<HTMLElement>('[data-workspace-surface-id]')
      return surface && root.contains(surface) && ids.has(surface.dataset.workspaceSurfaceId ?? '')
        ? surface
        : null
    }
    const placeWorkspace = (sourceId: string, surface: HTMLElement, x: number, y: number) => {
      const targetId = surface.dataset.workspaceSurfaceId!
      const target = dropTarget(surface, x, y)
      if (sourceId === targetId && !target.wholeWindow) {
        return
      }
      const state = useAppStore.getState()
      const existingGroup = findWorkspaceSplitGroup(state.workspaceSplitGroups, targetId)
      if (
        existingGroup &&
        !collectWorkspaceIds(existingGroup.layout).includes(sourceId) &&
        collectWorkspaceIds(existingGroup.layout).length >= MAX_WORKSPACE_PANES
      ) {
        toast.error(`A split can contain up to ${MAX_WORKSPACE_PANES} workspaces`)
        return
      }
      if (activateAndRevealWorkspace(sourceId, { revealInSidebar: false }) !== false) {
        useAppStore
          .getState()
          .placeWorkspaceAtEdge(sourceId, targetId, target.edge, target.wholeWindow)
      }
    }
    const onDragOver = (event: DragEvent) => {
      const surface = targetSurface(event)
      if (!surface || !event.dataTransfer) {
        setHover(null)
        return
      }
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      const next = dropTarget(surface, event.clientX, event.clientY)
      setHover((previous) =>
        previous?.id === next.id &&
        previous.edge === next.edge &&
        previous.wholeWindow === next.wholeWindow
          ? previous
          : next
      )
    }
    const onDrop = (event: DragEvent) => {
      const surface = targetSurface(event)
      setHover(null)
      if (!surface || !event.dataTransfer) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      const sourceId = readWorkspaceDragData(event.dataTransfer)
      if (!sourceId) {
        return
      }
      placeWorkspace(sourceId, surface, event.clientX, event.clientY)
    }
    const onDragEnd = () => setHover(null)
    const onPointerMove = (event: Event) => {
      const detail = readWorkspacePanePointerDetail(event)
      if (!detail) {
        return
      }
      const { sourceId, x, y } = detail
      const surface = pointerSurface(x, y)
      if (!surface) {
        setHover(null)
        return
      }
      const next = dropTarget(surface, x, y)
      if (next.id === sourceId && !next.wholeWindow) {
        setHover(null)
        return
      }
      setHover((previous) =>
        previous?.id === next.id &&
        previous.edge === next.edge &&
        previous.wholeWindow === next.wholeWindow
          ? previous
          : next
      )
    }
    const onPointerDrop = (event: Event) => {
      const detail = readWorkspacePanePointerDetail(event)
      if (!detail) {
        return
      }
      const { sourceId, x, y } = detail
      const surface = pointerSurface(x, y)
      setHover(null)
      if (!surface) {
        return
      }
      event.preventDefault()
      placeWorkspace(sourceId, surface, x, y)
    }
    const onPointerClear = () => setHover(null)
    document.addEventListener('dragover', onDragOver, true)
    document.addEventListener('drop', onDrop, true)
    document.addEventListener('dragend', onDragEnd, true)
    document.addEventListener(WORKSPACE_PANE_POINTER_MOVE, onPointerMove)
    document.addEventListener(WORKSPACE_PANE_POINTER_DROP, onPointerDrop)
    document.addEventListener(WORKSPACE_PANE_POINTER_CLEAR, onPointerClear)
    return () => {
      document.removeEventListener('dragover', onDragOver, true)
      document.removeEventListener('drop', onDrop, true)
      document.removeEventListener('dragend', onDragEnd, true)
      document.removeEventListener(WORKSPACE_PANE_POINTER_MOVE, onPointerMove)
      document.removeEventListener(WORKSPACE_PANE_POINTER_DROP, onPointerDrop)
      document.removeEventListener(WORKSPACE_PANE_POINTER_CLEAR, onPointerClear)
    }
  }, [visibleIdsKey, rendersRoot])
  if (!rendersRoot) {
    return null
  }
  const renderSurface = (workspace: (typeof workspaceSurfaces)[number], isVisible: boolean) => {
    const layout = getEffectiveLayoutForWorktree(workspace.id)
    const shouldMeasureHiddenWorktree =
      !isVisible && measurableBackgroundWorktreeIdsRef.current.has(workspace.id)
    const shouldColdParkTerminalPanes =
      !isVisible &&
      !shouldMeasureHiddenWorktree &&
      effectiveParkedTerminalWorktreeIds.has(workspace.id)
    return (
      <WorktreeSplitSurface
        key={`tab-groups-${workspace.id}`}
        worktreeId={workspace.id}
        worktreePath={workspace.path}
        layout={layout ?? null}
        focusedGroupId={activeGroupIdByWorktree[workspace.id]}
        isVisible={isVisible}
        isFocused={isVisible && workspace.id === renderedActiveWorktreeId}
        isMultiPane={group !== null && isVisible}
        hoverEdge={hover?.id === workspace.id && !hover.wholeWindow ? hover.edge : null}
        paneRect={group && isVisible ? paneRects.get(workspace.id) : undefined}
        shouldMeasureHiddenWorktree={shouldMeasureHiddenWorktree}
        shouldColdParkTerminalPanes={shouldColdParkTerminalPanes}
        isForceParked={forceParkedTerminalWorktreeIds.has(workspace.id)}
        activityTerminalPortals={activityTerminalPortals}
        backgroundMountTabIds={backgroundMountTabIdsByWorktreeRef.current.get(workspace.id) ?? null}
        activationDeferredMountTabIds={selectParkedEquivalentMountTabIds(
          activationDeferredMountTabIdsByWorktreeRef.current.get(workspace.id),
          startupTerminalTabHold,
          workspace.id
        )}
      />
    )
  }
  return (
    <div
      ref={rootRef}
      className={`relative flex flex-1 min-w-0 min-h-0 overflow-hidden${
        effectiveActiveLayout || group
          ? ''
          : retainBrowserGuestPaint
            ? ' opacity-0 pointer-events-none'
            : ' hidden'
      }`}
    >
      {group ? (
        <WorkspaceSplitLayoutSlots
          layout={group.layout}
          onRectsChange={setPaneRects}
          onRatioChange={onRatioChange}
        />
      ) : null}
      {mountedSurfaces.map((workspace) =>
        renderSurface(
          workspace,
          activeView === 'terminal' &&
            (group
              ? collectWorkspaceIds(group.layout).includes(workspace.id)
              : workspace.id === renderedActiveWorktreeId)
        )
      )}
      {hover?.wholeWindow ? <WorkspaceDropPreview edge={hover.edge} /> : null}
    </div>
  )
}
