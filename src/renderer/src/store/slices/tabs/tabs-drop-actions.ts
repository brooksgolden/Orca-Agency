import { createBrowserUuid } from '@/lib/browser-uuid'
import type { TabGroup } from '../../../../../shared/tab-types'
import type { TabsSlice, TabsSliceGet, TabsSliceSet } from './tabs-slice-contract'
import { isPaneColumnSplitDropNoOp } from '../../../../../shared/workspace-layout/pane-column-split-drop-no-op'
import {
  collapseGroupLayout,
  buildSplitNode,
  replaceLeaf
} from '../../../../../shared/workspace-layout/tab-group-layout-tree'
import { buildActiveSurfacePatch } from './tabs-surface'
import {
  findGroupAndWorktree,
  findGroupForTab,
  findTabAndWorktree,
  pickNextActiveTab,
  pushRecentTabId,
  sanitizeRecentTabIds
} from '../tab-group-state'
import { dedupeTabOrder } from '../../../../../shared/workspace-layout/tab-order'

import type { AppState } from '../../types'

export function projectTabDrop(
  state: AppState,
  tabId: string,
  target: Parameters<TabsSlice['dropUnifiedTab']>[1],
  splitGroupId?: string
): Partial<AppState> | null {
  const foundTab = findTabAndWorktree(state.unifiedTabsByWorktree, tabId)
  const foundTarget = findGroupAndWorktree(state.groupsByWorktree, target.groupId)
  if (!foundTab || !foundTarget || foundTab.worktreeId !== foundTarget.worktreeId) {
    return null
  }

  const { tab, worktreeId } = foundTab
  const sourceGroup = findGroupForTab(state.groupsByWorktree, worktreeId, tab.groupId)
  const targetGroup = foundTarget.group
  if (!sourceGroup) {
    return null
  }

  const isSplitDrop = Boolean(target.splitDirection)
  if (!isSplitDrop && tab.groupId === target.groupId) {
    return null
  }
  const layout = state.layoutByWorktree[worktreeId]
  if (
    isSplitDrop &&
    isPaneColumnSplitDropNoOp({
      sourceGroupId: sourceGroup.id,
      targetGroupId: target.groupId,
      splitDirection: target.splitDirection!,
      sourceTabCount: sourceGroup.tabOrder.length,
      layout
    })
  ) {
    // Why: dropping a group's last tab on its own/sibling matching edge only makes a transient column that immediately collapses.
    return null
  }

  let nextGroups = state.groupsByWorktree[worktreeId] ?? []
  let nextLayoutByWorktree = state.layoutByWorktree
  let nextActiveGroupIdByWorktree = state.activeGroupIdByWorktree
  let resolvedTargetGroupId = target.groupId

  if (target.splitDirection) {
    const newGroupId = splitGroupId ?? createBrowserUuid()
    const newGroup: TabGroup = {
      id: newGroupId,
      worktreeId,
      activeTabId: null, // Placeholder; properly set in the nextGroups.map() below
      tabOrder: []
    }
    const currentLayout =
      nextLayoutByWorktree[worktreeId] ?? ({ type: 'leaf', groupId: target.groupId } as const)
    const replacement = buildSplitNode(
      target.groupId,
      newGroupId,
      target.splitDirection === 'left' || target.splitDirection === 'right'
        ? 'horizontal'
        : 'vertical',
      target.splitDirection === 'left' || target.splitDirection === 'up' ? 'first' : 'second'
    )

    resolvedTargetGroupId = newGroupId
    nextGroups = [...nextGroups, newGroup]
    nextLayoutByWorktree = {
      ...nextLayoutByWorktree,
      [worktreeId]: replaceLeaf(currentLayout, target.groupId, replacement)
    }
    nextActiveGroupIdByWorktree = {
      ...nextActiveGroupIdByWorktree,
      [worktreeId]: newGroupId
    }
  }

  const dedupedSourceGroupOrder = dedupeTabOrder(sourceGroup.tabOrder)
  const sourceOrder = dedupeTabOrder(dedupedSourceGroupOrder.filter((id) => id !== tabId))
  const destinationGroup =
    nextGroups.find((group) => group.id === resolvedTargetGroupId) ?? targetGroup
  // Why: target order may already hold this tab id (racey write / same-group split); dedupe first or React hits a duplicate key.
  const targetOrder = dedupeTabOrder(destinationGroup.tabOrder.filter((id) => id !== tabId))
  const targetIndex = Math.max(0, Math.min(target.index ?? targetOrder.length, targetOrder.length))
  targetOrder.splice(targetIndex, 0, tabId)

  const sourceRecentTabIds = sanitizeRecentTabIds(
    (sourceGroup.recentTabIds ?? []).filter((id) => id !== tabId),
    sourceOrder
  )
  nextGroups = nextGroups.map((group) => {
    if (group.id === sourceGroup.id) {
      return {
        ...group,
        activeTabId:
          group.activeTabId === tabId
            ? // Why: same MRU-aware fallback as moveUnifiedTabToGroup — the drag keeps the user on their previously-active tab.
              pickNextActiveTab(
                dedupedSourceGroupOrder,
                sourceGroup.recentTabIds,
                tabId,
                state.unifiedTabsByWorktree[worktreeId]
              )
            : group.activeTabId,
        tabOrder: sourceOrder,
        recentTabIds: sourceRecentTabIds
      }
    }
    if (group.id === resolvedTargetGroupId) {
      return {
        ...group,
        activeTabId: tabId,
        tabOrder: targetOrder,
        recentTabIds: pushRecentTabId(sanitizeRecentTabIds(group.recentTabIds, targetOrder), tabId)
      }
    }
    return group
  })

  if (sourceOrder.length === 0) {
    nextGroups = nextGroups.filter((group) => group.id !== sourceGroup.id)
    const collapsedState = collapseGroupLayout(
      nextLayoutByWorktree,
      nextActiveGroupIdByWorktree,
      worktreeId,
      sourceGroup.id,
      resolvedTargetGroupId
    )
    nextLayoutByWorktree = collapsedState.layoutByWorktree
    nextActiveGroupIdByWorktree = collapsedState.activeGroupIdByWorktree
  } else {
    nextActiveGroupIdByWorktree = {
      ...nextActiveGroupIdByWorktree,
      [worktreeId]: resolvedTargetGroupId
    }
  }

  const nextUnifiedTabsByWorktree = {
    ...state.unifiedTabsByWorktree,
    [worktreeId]: (state.unifiedTabsByWorktree[worktreeId] ?? []).map((candidate) =>
      candidate.id === tabId ? { ...candidate, groupId: resolvedTargetGroupId } : candidate
    )
  }
  const nextGroupsByWorktree = {
    ...state.groupsByWorktree,
    [worktreeId]: nextGroups
  }

  return {
    unifiedTabsByWorktree: nextUnifiedTabsByWorktree,
    groupsByWorktree: nextGroupsByWorktree,
    layoutByWorktree: nextLayoutByWorktree,
    activeGroupIdByWorktree: nextActiveGroupIdByWorktree,
    ...(state.activeWorktreeId === worktreeId
      ? buildActiveSurfacePatch(
          {
            ...state,
            unifiedTabsByWorktree: nextUnifiedTabsByWorktree,
            groupsByWorktree: nextGroupsByWorktree,
            layoutByWorktree: nextLayoutByWorktree,
            activeGroupIdByWorktree: nextActiveGroupIdByWorktree
          },
          worktreeId,
          resolvedTargetGroupId
        )
      : {})
  }
}

export function createTabsDropActions(
  set: TabsSliceSet,
  get: TabsSliceGet
): Pick<TabsSlice, 'dropUnifiedTab'> {
  return {
    dropUnifiedTab: (tabId, target) => {
      let moved = false
      set((state) => {
        const patch = projectTabDrop(state, tabId, target)
        moved = patch !== null
        return patch ?? state
      })
      if (moved) {
        get().recordFeatureInteraction?.('terminal-tabs')
        get().recordFeatureInteraction?.('tab-splits')
      }
      return moved
    }
  }
}
