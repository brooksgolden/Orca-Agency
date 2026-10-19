import { useCallback, useRef, useState, type RefObject } from 'react'
import type { DragMoveEvent, DragOverEvent } from '@dnd-kit/core'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../../shared/constants'
import { useAppStore } from '../../store'
import type { useHoveredTabInsertion } from './tab-insertion'
import { resolvePointerStripInsertion } from './tab-insertion'
import { applyDragPreviewTab, type TabDragActivationSnapshot } from './tab-drag-preview-activation'
import { resolveDragPreviewTabId } from './tab-drag-preview-target'
import { getDragPointer } from './tab-drag-pointer'
import {
  findTabGroupPanelUnderPointer,
  resolveActivePaneColumnSplitTarget,
  type ActivePaneColumnSplitTarget,
  type TabGroupPanelGeometrySnapshot
} from './tab-group-panel-split-target'
import { findTabGroupStripUnderPointer, type TabGroupStripHit } from './tab-group-strip-hit'
import { isTabDragData, type TabDragItemData, type TabDropZone } from './tab-drag-data'

export type HoveredTabDropTarget = {
  groupId: string
  zone: TabDropZone
  panelRect?: DOMRect
}

/** Derives the in-flight hover state of a tab drag: the live preview tab to
 *  activate (deduped through private memo refs) and the hovered pane-column
 *  split target, delegating tab-strip insertion to the injected tabInsertion. */
export function useTabDragHoverPreview({
  worktreeId,
  preDragActivationSnapshotRef,
  dragGeometryRef,
  tabInsertion
}: {
  worktreeId: string
  preDragActivationSnapshotRef: RefObject<TabDragActivationSnapshot | null>
  dragGeometryRef: RefObject<TabGroupPanelGeometrySnapshot | null>
  tabInsertion: ReturnType<typeof useHoveredTabInsertion>
}): {
  clear: () => void
  handleDragUpdate: (event: DragMoveEvent | DragOverEvent) => void
  hoveredDropTarget: HoveredTabDropTarget | null
} {
  const [hoveredDropTarget, setHoveredDropTarget] = useState<HoveredTabDropTarget | null>(null)
  const lastPreviewRef = useRef<{ groupId: string; tabId: string | null } | null>(null)
  const lastHoveredTabPreviewRef = useRef<{ groupId: string; tabId: string } | null>(null)

  const updateDragPreviewActivation = useCallback(
    (
      activeData: TabDragItemData,
      strip: TabGroupStripHit | null,
      panel: { groupId: string } | null
    ) => {
      const snapshot = preDragActivationSnapshotRef.current
      if (!snapshot) {
        return
      }

      if (strip?.tabAtPointer && strip.tabAtPointer.unifiedTabId !== activeData.unifiedTabId) {
        lastHoveredTabPreviewRef.current = {
          groupId: strip.groupId,
          tabId: strip.tabAtPointer.unifiedTabId
        }
      }

      const preview =
        worktreeId === FLOATING_TERMINAL_WORKTREE_ID
          ? {
              groupId: activeData.groupId,
              tabId: snapshot.activeTabIdByGroup[activeData.groupId] ?? null
            }
          : resolveDragPreviewTabId({
              activeDrag: activeData,
              overData:
                panel && !strip ? { kind: 'pane-body', worktreeId, groupId: panel.groupId } : null,
              preDragActiveTabIdByGroup: snapshot.activeTabIdByGroup,
              lastHoveredTabPreview: lastHoveredTabPreviewRef.current
            })
      const lastPreview = lastPreviewRef.current
      if (lastPreview?.groupId === preview.groupId && lastPreview.tabId === preview.tabId) {
        return
      }
      lastPreviewRef.current = preview
      applyDragPreviewTab({
        worktreeId,
        groupId: preview.groupId,
        tabId: preview.tabId,
        activeGroupId: preview.groupId
      })
    },
    [preDragActivationSnapshotRef, worktreeId]
  )

  const updateHoveredDropTargetFromSplit = useCallback(
    (splitTarget: ActivePaneColumnSplitTarget | null) => {
      if (!splitTarget) {
        setHoveredDropTarget((prev) => (prev === null ? prev : null))
        return
      }
      setHoveredDropTarget((prev) => {
        if (prev?.groupId === splitTarget.groupId && prev?.zone === splitTarget.zone) {
          return prev
        }
        return {
          groupId: splitTarget.groupId,
          zone: splitTarget.zone,
          panelRect: splitTarget.panelRect
        }
      })
    },
    []
  )

  const handleDragUpdate = useCallback(
    (event: DragMoveEvent | DragOverEvent) => {
      const activeData = event.active.data.current
      const state = useAppStore.getState()
      const pointer = getDragPointer(event)
      const strip = pointer ? findTabGroupStripUnderPointer(worktreeId, pointer) : null
      const panel = pointer
        ? findTabGroupPanelUnderPointer(worktreeId, pointer, { geometry: dragGeometryRef.current })
        : null
      if (isTabDragData(activeData) && activeData.worktreeId === worktreeId) {
        updateDragPreviewActivation(activeData, strip, panel)
      }
      const splitTarget =
        !strip && panel
          ? resolveActivePaneColumnSplitTarget({
              event,
              groupsByWorktree: state.groupsByWorktree,
              layoutByWorktree: state.layoutByWorktree,
              worktreeId,
              getDragPointer,
              geometry: dragGeometryRef.current
            })
          : null
      updateHoveredDropTargetFromSplit(splitTarget)
      if (splitTarget) {
        tabInsertion.clear()
      } else {
        const tabOrder = (state.groupsByWorktree[worktreeId] ?? []).find(
          (group) => group.id === strip?.groupId
        )?.tabOrder
        tabInsertion.set(resolvePointerStripInsertion(event, strip, pointer, tabOrder))
      }
    },
    [
      dragGeometryRef,
      tabInsertion,
      updateDragPreviewActivation,
      updateHoveredDropTargetFromSplit,
      worktreeId
    ]
  )

  const clear = useCallback(() => {
    setHoveredDropTarget(null)
    lastPreviewRef.current = null
    lastHoveredTabPreviewRef.current = null
  }, [])

  return { clear, handleDragUpdate, hoveredDropTarget }
}
