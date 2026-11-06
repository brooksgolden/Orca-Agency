import { useEffect, type RefObject, type Dispatch, type SetStateAction } from 'react'
import { useAppStore } from '@/store'
import { isLocalTabDrop } from './workspace-local-tab-drop'
import { readWorkspaceDragData, WORKSPACE_STATUS_DRAG_TYPE } from '../sidebar/workspace-status'
import { activateAndRevealWorkspace } from '@/lib/worktree-activation'
import { toast } from 'sonner'
import {
  WORKSPACE_PANE_POINTER_CLEAR,
  WORKSPACE_PANE_POINTER_DROP,
  WORKSPACE_PANE_POINTER_MOVE,
  readWorkspacePanePointerDetail
} from './workspace-pane-pointer-drag'
import { workspaceDropSurface } from './workspace-drop-surface'
import { workspaceSurfaceDropTarget } from './workspace-surface-drop-target'
import {
  workspaceTabStripDropTarget,
  workspaceForeignTabStripAtPoint,
  dropTerminalTabIntoWorkspaceStrip
} from './workspace-tab-strip-drop'
import { canDropTabAtWorkspaceEdge, dropTabAtWorkspaceEdge } from './workspace-tab-edge-drop'
import { captureNativeWorkspaceDragSource } from './workspace-native-drag-source'
import { translate } from '@/i18n/i18n'

import type { WorkspaceDropHover } from './workspace-drop-hover'
export type { WorkspaceDropHover } from './workspace-drop-hover'

const layoutChangedOrFull = (): string =>
  translate(
    'auto.components.workspaceSplit.useWorkspaceDropTargets.layoutChangedOrFull',
    'This pane layout changed or is full. Its contents have been kept intact.'
  )

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
    const nativeDrag = captureNativeWorkspaceDragSource()
    const dropTarget = (
      surface: HTMLElement,
      x: number,
      y: number,
      sourceId?: string,
      unifiedTabId?: string,
      sourceGroupId?: string
    ) => workspaceSurfaceDropTarget(root, ids, surface, x, y, sourceId, unifiedTabId, sourceGroupId)
    const surfaceAtPoint = (element: Element | null, x: number, y: number) =>
      workspaceDropSurface(root, ids, element, x, y)
    const targetSurface = (event: DragEvent): HTMLElement | null =>
      Array.from(event.dataTransfer?.types ?? []).includes(WORKSPACE_STATUS_DRAG_TYPE)
        ? surfaceAtPoint(
            event.target instanceof Element ? event.target : null,
            event.clientX,
            event.clientY
          )
        : null
    const pointerSurface = (x: number, y: number): HTMLElement | null =>
      surfaceAtPoint(document.elementFromPoint(x, y), x, y)
    const overSourceTabStrip = (sourceId: string, surface: HTMLElement, x: number, y: number) =>
      surface.dataset.workspaceSurfaceId === sourceId &&
      Boolean(document.elementFromPoint(x, y)?.closest('[data-tab-group-strip-id]'))
    const placeWorkspace = (
      sourceId: string,
      surface: HTMLElement,
      x: number,
      y: number,
      sourceGroupId?: string
    ) => {
      const target = dropTarget(surface, x, y, sourceId, undefined, sourceGroupId)
      if (
        sourceId === target.id &&
        (!sourceGroupId || sourceGroupId === target.targetGroupId) &&
        !target.wholeWindow &&
        !target.placement
      ) {
        return
      }
      if (target.blocked) {
        toast.error(layoutChangedOrFull())
        return
      }

      if (
        activateAndRevealWorkspace(sourceId, {
          revealInSidebar: false,
          providesInitialSurface: true
        }) !== false
      ) {
        useAppStore
          .getState()
          .placeWorkspaceSurface(
            { type: 'leaf', workspaceId: sourceId, groupId: sourceGroupId },
            { type: 'leaf', workspaceId: target.id, groupId: target.targetGroupId },
            target.edge,
            { wholeWindow: target.wholeWindow, placement: target.placement }
          )
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
      const next = dropTarget(
        surface,
        event.clientX,
        event.clientY,
        nativeDrag.sourceId() ?? readWorkspaceDragData(event.dataTransfer) ?? undefined
      )
      const sourceId = nativeDrag.sourceId() ?? readWorkspaceDragData(event.dataTransfer)
      if (next.blocked) {
        setHover(null)
        return
      }
      if (sourceId === next.id && !next.wholeWindow && !next.placement) {
        setHover(null)
        return
      }
      setHover((previous) =>
        previous?.id === next.id &&
        previous.edge === next.edge &&
        previous.wholeWindow === next.wholeWindow &&
        previous.targetGroupId === next.targetGroupId &&
        JSON.stringify(previous.placement) === JSON.stringify(next.placement) &&
        !previous.strip
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
    const onPointerMove = (event: Event) => {
      const detail = readWorkspacePanePointerDetail(event)
      if (!detail) {
        return
      }
      const { sourceId, x, y } = detail
      const strip = detail.unifiedTabId
        ? workspaceTabStripDropTarget(sourceId, detail.unifiedTabId, x, y)
        : null
      if (strip) {
        event.preventDefault()
        setHover({ id: strip.targetId, edge: 'top', wholeWindow: false, strip })
        return
      }
      if (detail.unifiedTabId && workspaceForeignTabStripAtPoint(sourceId, x, y)) {
        event.preventDefault()
        setHover(null)
        return
      }
      if (detail.unifiedTabId && !canDropTabAtWorkspaceEdge(sourceId, detail.unifiedTabId)) {
        setHover(null)
        return
      }
      const surface = pointerSurface(x, y)
      if (!surface || (detail.unifiedTabId && overSourceTabStrip(sourceId, surface, x, y))) {
        setHover(null)
        return
      }
      const next = dropTarget(surface, x, y, sourceId, detail.unifiedTabId, detail.sourceGroupId)
      const localTabDrop = detail.unifiedTabId && isLocalTabDrop(next, sourceId, x, y)
      if (localTabDrop) {
        setHover(null)
        return
      }
      if (
        next.id === sourceId &&
        !next.wholeWindow &&
        !next.placement &&
        (!detail.sourceGroupId || detail.sourceGroupId === next.targetGroupId)
      ) {
        setHover(null)
        return
      }
      if (next.blocked) {
        event.preventDefault()
        setHover(null)
        return
      }

      event.preventDefault()
      setHover((previous) =>
        previous?.id === next.id &&
        previous.edge === next.edge &&
        previous.wholeWindow === next.wholeWindow &&
        previous.targetGroupId === next.targetGroupId &&
        JSON.stringify(previous.placement) === JSON.stringify(next.placement) &&
        !previous.strip
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
      const strip = detail.unifiedTabId
        ? workspaceTabStripDropTarget(sourceId, detail.unifiedTabId, x, y)
        : null
      if (strip && detail.unifiedTabId) {
        event.preventDefault()
        setHover(null)
        void dropTerminalTabIntoWorkspaceStrip(sourceId, detail.unifiedTabId, strip).catch(
          (error: unknown) =>
            toast.error(
              error instanceof Error
                ? error.message
                : translate('auto.workspaceDrop.couldNotCombineChats', 'Could not combine chats.')
            )
        )
        return
      }
      if (detail.unifiedTabId && workspaceForeignTabStripAtPoint(sourceId, x, y)) {
        event.preventDefault()
        setHover(null)
        return
      }
      if (detail.unifiedTabId && !canDropTabAtWorkspaceEdge(sourceId, detail.unifiedTabId)) {
        setHover(null)
        return
      }
      const surface = pointerSurface(x, y)
      setHover(null)
      if (!surface || (detail.unifiedTabId && overSourceTabStrip(sourceId, surface, x, y))) {
        return
      }
      const target = dropTarget(surface, x, y, sourceId, detail.unifiedTabId, detail.sourceGroupId)
      const localTabDrop = detail.unifiedTabId && isLocalTabDrop(target, sourceId, x, y)
      if (localTabDrop) {
        setHover(null)
        return
      }
      if (
        target.id === sourceId &&
        !target.wholeWindow &&
        !target.placement &&
        (!detail.sourceGroupId || detail.sourceGroupId === target.targetGroupId)
      ) {
        return
      }
      if (target.blocked) {
        event.preventDefault()
        toast.error(layoutChangedOrFull())
        return
      }

      event.preventDefault()
      if (detail.unifiedTabId) {
        void dropTabAtWorkspaceEdge({
          sourceId,
          unifiedTabId: detail.unifiedTabId,
          targetId: target.id,
          edge: target.edge,
          wholeWindow: target.wholeWindow,
          placement: target.placement,
          targetGroupId: target.targetGroupId
        }).catch((error: unknown) =>
          toast.error(error instanceof Error ? error.message : 'Could not move chat.')
        )
        return
      }
      placeWorkspace(sourceId, surface, x, y, detail.sourceGroupId)
    }
    const onPointerClear = () => setHover(null)
    document.addEventListener('dragover', onDragOver, true)
    document.addEventListener('drop', onDrop, true)
    document.addEventListener('dragend', onPointerClear, true)
    document.addEventListener(WORKSPACE_PANE_POINTER_MOVE, onPointerMove)
    document.addEventListener(WORKSPACE_PANE_POINTER_DROP, onPointerDrop)
    document.addEventListener(WORKSPACE_PANE_POINTER_CLEAR, onPointerClear)
    return () => {
      nativeDrag.dispose()
      document.removeEventListener('dragover', onDragOver, true)
      document.removeEventListener('drop', onDrop, true)
      document.removeEventListener('dragend', onPointerClear, true)
      document.removeEventListener(WORKSPACE_PANE_POINTER_MOVE, onPointerMove)
      document.removeEventListener(WORKSPACE_PANE_POINTER_DROP, onPointerDrop)
      document.removeEventListener(WORKSPACE_PANE_POINTER_CLEAR, onPointerClear)
    }
  }, [visibleIdsKey, rendersRoot, rootRef, setHover])
}
