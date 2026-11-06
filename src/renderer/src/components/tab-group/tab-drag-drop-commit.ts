/* eslint-disable max-lines -- Why: Drop commit logic preserves one transaction across pointer resolution, store movement, and web runtime mirroring. */
import type { RefObject } from 'react'
import type { DragEndEvent } from '@dnd-kit/core'
import { useAppStore } from '../../store'
import { mirrorWebRuntimeTabMove } from '../tab-bar/web-runtime-tab-move-mirror'
import { resolvePointerStripInsertion, type HoveredTabInsertion } from './tab-insertion'
import { resolveSourceGroupRestoreOnDrop } from './tab-drag-preview-target'
import { getDragPointer } from './tab-drag-pointer'
import {
  findTabGroupPanelUnderPointer,
  resolveActivePaneColumnSplitTarget,
  type TabGroupPanelGeometrySnapshot
} from './tab-group-panel-split-target'
import { findTabGroupStripUnderPointer } from './tab-group-strip-hit'
import { isPaneDropData, isTabDragData, type TabDragItemData } from './tab-drag-data'
import { ORCA_LAYOUT_OWNER_IS_MAIN } from '../../../../shared/layout-owner-switch'
import { dropTabThroughLayoutOwner } from './tab-group-layout-owner-commands'

type AppState = ReturnType<typeof useAppStore.getState>

/** Commit splits/reorders/moves through the layout owner or window path, then finish or restore the drag snapshot. */
export function commitTabDragDrop({
  event,
  worktreeId,
  dragGeometryRef,
  hoveredTabInsertion,
  dropUnifiedTab,
  reorderUnifiedTabs,
  finishDrag
}: {
  event: DragEndEvent
  worktreeId: string
  dragGeometryRef: RefObject<TabGroupPanelGeometrySnapshot | null>
  hoveredTabInsertion: HoveredTabInsertion | null
  dropUnifiedTab: AppState['dropUnifiedTab']
  reorderUnifiedTabs: AppState['reorderUnifiedTabs']
  finishDrag: (restoreSnapshot: boolean, activeData?: TabDragItemData) => void
}): void {
  const activeData = event.active.data.current
  const overData = event.over?.data.current
  let shouldRestorePreDragActivation = true

  if (!isTabDragData(activeData) || activeData.worktreeId !== worktreeId) {
    finishDrag(true)
    return
  }

  const state = useAppStore.getState()
  const pointer = getDragPointer(event)
  const panelHit = pointer
    ? findTabGroupPanelUnderPointer(worktreeId, pointer, { geometry: dragGeometryRef.current })
    : null
  const stripHit = pointer ? findTabGroupStripUnderPointer(worktreeId, pointer) : null
  const stripTabOrder = (state.groupsByWorktree[worktreeId] ?? []).find(
    (group) => group.id === stripHit?.groupId
  )?.tabOrder
  const markedInsertion =
    resolvePointerStripInsertion(event, stripHit, pointer, stripTabOrder) ??
    (stripHit &&
    !stripHit.tabAtPointer &&
    !stripHit.lastTab &&
    hoveredTabInsertion?.groupId === stripHit.groupId
      ? hoveredTabInsertion
      : null)
  if (stripHit?.blocked) {
    finishDrag(true)
    return
  }
  const paneColumnSplit = resolveActivePaneColumnSplitTarget({
    event,
    groupsByWorktree: state.groupsByWorktree,
    layoutByWorktree: state.layoutByWorktree,
    worktreeId,
    getDragPointer,
    geometry: dragGeometryRef.current
  })
  if (paneColumnSplit && !stripHit) {
    // End the drag now; main’s answer draws the requested pane placement.
    if (
      ORCA_LAYOUT_OWNER_IS_MAIN &&
      dropTabThroughLayoutOwner(worktreeId, {
        kind: 'split',
        tabId: activeData.unifiedTabId,
        groupId: paneColumnSplit.groupId,
        direction: paneColumnSplit.zone
      })
    ) {
      finishDrag(true)
      return
    }
    const moved = dropUnifiedTab(activeData.unifiedTabId, {
      groupId: paneColumnSplit.groupId,
      splitDirection: paneColumnSplit.zone
    })
    if (moved) {
      shouldRestorePreDragActivation = false
      mirrorWebRuntimeTabMove({
        kind: 'split',
        worktreeId,
        tabId: activeData.unifiedTabId,
        targetGroupId: paneColumnSplit.groupId,
        splitDirection: paneColumnSplit.zone
      })
    }
    finishDrag(
      shouldRestorePreDragActivation,
      resolveSourceGroupRestoreOnDrop(
        activeData,
        paneColumnSplit.groupId,
        shouldRestorePreDragActivation
      )
    )
    return
  }

  if (!event.over && !markedInsertion && !stripHit && !panelHit) {
    finishDrag(true)
    return
  }

  if (pointer && !panelHit && !stripHit) {
    finishDrag(true)
    return
  }

  const releaseOverTabInStrip =
    stripHit &&
    pointer &&
    event.over &&
    isTabDragData(overData) &&
    overData.groupId === stripHit.groupId &&
    (!stripHit.tabAtPointer || stripHit.tabAtPointer.visibleTabId === overData.visibleTabId) &&
    pointer.x >= event.over.rect.left &&
    pointer.x <= event.over.rect.left + event.over.rect.width &&
    pointer.y >= event.over.rect.top &&
    pointer.y <= event.over.rect.top + event.over.rect.height
  if (stripHit?.tabAtPointer && !markedInsertion && !releaseOverTabInStrip) {
    finishDrag(true)
    return
  }
  if (stripHit && !markedInsertion && !releaseOverTabInStrip) {
    if (stripHit.lastTab) {
      finishDrag(true)
      return
    }
    const targetGroup = (state.groupsByWorktree[worktreeId] ?? []).find(
      (group) => group.id === stripHit.groupId
    )
    if (!targetGroup) {
      finishDrag(true)
      return
    }
    if (activeData.groupId === targetGroup.id) {
      const nextOrder = targetGroup.tabOrder.filter((id) => id !== activeData.unifiedTabId)
      nextOrder.push(activeData.unifiedTabId)
      if (nextOrder.some((id, index) => id !== targetGroup.tabOrder[index])) {
        reorderUnifiedTabs(targetGroup.id, nextOrder)
        mirrorWebRuntimeTabMove({
          kind: 'reorder',
          worktreeId,
          tabId: activeData.unifiedTabId,
          targetGroupId: targetGroup.id,
          tabOrder: nextOrder
        })
      }
    } else {
      const index = targetGroup.tabOrder.length
      if (dropUnifiedTab(activeData.unifiedTabId, { groupId: targetGroup.id, index })) {
        shouldRestorePreDragActivation = false
        mirrorWebRuntimeTabMove({
          kind: 'move-to-group',
          worktreeId,
          tabId: activeData.unifiedTabId,
          targetGroupId: targetGroup.id,
          index
        })
      }
    }
    finishDrag(
      shouldRestorePreDragActivation,
      resolveSourceGroupRestoreOnDrop(activeData, targetGroup.id, shouldRestorePreDragActivation)
    )
    return
  }

  if (pointer && !stripHit && panelHit) {
    if (activeData.groupId !== panelHit.groupId) {
      if (dropUnifiedTab(activeData.unifiedTabId, { groupId: panelHit.groupId })) {
        shouldRestorePreDragActivation = false
        mirrorWebRuntimeTabMove({
          kind: 'move-to-group',
          worktreeId,
          tabId: activeData.unifiedTabId,
          targetGroupId: panelHit.groupId
        })
      }
    }
    finishDrag(
      shouldRestorePreDragActivation,
      resolveSourceGroupRestoreOnDrop(activeData, panelHit.groupId, shouldRestorePreDragActivation)
    )
    return
  }

  if (markedInsertion || isTabDragData(overData)) {
    const insertion = markedInsertion
    const targetTab = insertion
      ? (state.unifiedTabsByWorktree[worktreeId] ?? []).find(
          (tab) => tab.id === insertion.unifiedTabId && tab.groupId === insertion.groupId
        )
      : undefined
    if (!insertion || !targetTab || activeData.unifiedTabId === targetTab.id) {
      finishDrag(true)
      return
    }

    const groups = state.groupsByWorktree[worktreeId] ?? []
    const targetGroup = groups.find((group) => group.id === targetTab.groupId)
    if (!targetGroup) {
      finishDrag(true)
      return
    }

    // Keep the side shown by the insertion marker; fall back to the release
    // event only when there was no valid marker at the pointer position.
    const overIndex = targetGroup.tabOrder.indexOf(targetTab.id)
    const rawInsertIndex = overIndex + (insertion.side === 'right' ? 1 : 0)

    if (activeData.groupId === targetTab.groupId) {
      const oldIndex = targetGroup.tabOrder.indexOf(activeData.unifiedTabId)
      // Adjust forward insertion after removing the source tab so the target slot does not shift left.
      const nextIndex = oldIndex < rawInsertIndex ? rawInsertIndex - 1 : rawInsertIndex
      if (oldIndex !== -1 && oldIndex !== nextIndex) {
        const nextOrder = targetGroup.tabOrder.filter((id) => id !== activeData.unifiedTabId)
        nextOrder.splice(nextIndex, 0, activeData.unifiedTabId)
        if (
          ORCA_LAYOUT_OWNER_IS_MAIN &&
          dropTabThroughLayoutOwner(worktreeId, {
            kind: 'reorder',
            tabId: activeData.unifiedTabId,
            groupId: targetTab.groupId,
            tabOrder: nextOrder
          })
        ) {
          finishDrag(true)
          return
        }
        reorderUnifiedTabs(targetTab.groupId, nextOrder)
        mirrorWebRuntimeTabMove({
          kind: 'reorder',
          worktreeId,
          tabId: activeData.unifiedTabId,
          targetGroupId: targetTab.groupId,
          tabOrder: nextOrder
        })
      }
    } else {
      const index = overIndex === -1 ? targetGroup.tabOrder.length : rawInsertIndex
      if (
        ORCA_LAYOUT_OWNER_IS_MAIN &&
        dropTabThroughLayoutOwner(worktreeId, {
          kind: 'move',
          tabId: activeData.unifiedTabId,
          groupId: targetTab.groupId,
          index
        })
      ) {
        finishDrag(true)
        return
      }
      const moved = dropUnifiedTab(activeData.unifiedTabId, {
        groupId: targetTab.groupId,
        index
      })
      if (moved) {
        shouldRestorePreDragActivation = false
        mirrorWebRuntimeTabMove({
          kind: 'move-to-group',
          worktreeId,
          tabId: activeData.unifiedTabId,
          targetGroupId: targetTab.groupId,
          index
        })
      }
    }

    finishDrag(
      shouldRestorePreDragActivation,
      resolveSourceGroupRestoreOnDrop(activeData, targetTab.groupId, shouldRestorePreDragActivation)
    )
    return
  }

  if (isPaneDropData(overData)) {
    if (activeData.groupId !== overData.groupId) {
      if (
        ORCA_LAYOUT_OWNER_IS_MAIN &&
        dropTabThroughLayoutOwner(worktreeId, {
          kind: 'move',
          tabId: activeData.unifiedTabId,
          groupId: overData.groupId
        })
      ) {
        finishDrag(true)
        return
      }
      const moved = dropUnifiedTab(activeData.unifiedTabId, {
        groupId: overData.groupId
      })
      if (moved) {
        shouldRestorePreDragActivation = false
        mirrorWebRuntimeTabMove({
          kind: 'move-to-group',
          worktreeId,
          tabId: activeData.unifiedTabId,
          targetGroupId: overData.groupId
        })
      }
    }
  }

  finishDrag(
    shouldRestorePreDragActivation,
    isPaneDropData(overData)
      ? resolveSourceGroupRestoreOnDrop(
          activeData,
          overData.groupId,
          shouldRestorePreDragActivation
        )
      : undefined
  )
}
