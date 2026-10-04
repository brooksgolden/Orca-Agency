import { useEffect, type RefObject, type Dispatch, type SetStateAction } from 'react'
import { useAppStore } from '@/store'
import {
  collectWorkspaceIds,
  findWorkspaceSplitGroup,
  MAX_WORKSPACE_PANES,
  type WorkspaceSplitEdge
} from '@/lib/workspace-split-layout'
import { readWorkspaceDragData, WORKSPACE_STATUS_DRAG_TYPE } from '../sidebar/workspace-status'
import { activateAndRevealWorkspace } from '@/lib/worktree-activation'
import { toast } from 'sonner'
import {
  WORKSPACE_PANE_POINTER_CLEAR,
  WORKSPACE_PANE_POINTER_DROP,
  WORKSPACE_PANE_POINTER_MOVE,
  readWorkspacePanePointerDetail
} from './workspace-pane-pointer-drag'
import { workspaceDropTarget } from './workspace-drop-target'
import {
  canDropTerminalTabAtWorkspaceEdge,
  dropTerminalTabAtWorkspaceEdge
} from './workspace-tab-edge-drop'

export type WorkspaceDropHover = { id: string; edge: WorkspaceSplitEdge; wholeWindow: boolean }

export function useWorkspaceDropTargets(
  rootRef: RefObject<HTMLDivElement | null>,
  visibleIdsKey: string,
  rendersRoot: boolean,
  setHover: Dispatch<SetStateAction<WorkspaceDropHover | null>>
): void {
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
      if (
        detail.unifiedTabId &&
        !canDropTerminalTabAtWorkspaceEdge(sourceId, detail.unifiedTabId)
      ) {
        setHover(null)
        return
      }
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
      event.preventDefault()
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
      if (
        detail.unifiedTabId &&
        !canDropTerminalTabAtWorkspaceEdge(sourceId, detail.unifiedTabId)
      ) {
        setHover(null)
        return
      }
      const surface = pointerSurface(x, y)
      setHover(null)
      if (!surface) {
        return
      }
      const target = dropTarget(surface, x, y)
      if (target.id === sourceId && !target.wholeWindow) {
        return
      }
      event.preventDefault()
      if (detail.unifiedTabId) {
        void dropTerminalTabAtWorkspaceEdge({
          sourceId,
          unifiedTabId: detail.unifiedTabId,
          targetId: target.id,
          edge: target.edge,
          wholeWindow: target.wholeWindow
        }).catch((error: unknown) =>
          toast.error(error instanceof Error ? error.message : 'Could not move chat.')
        )
        return
      }
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
  }, [visibleIdsKey, rendersRoot, rootRef, setHover])
}
