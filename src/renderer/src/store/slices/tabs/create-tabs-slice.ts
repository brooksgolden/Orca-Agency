import type { StateCreator } from 'zustand'
import type { AppState } from '../../types'
import type { TabsSlice, TabsSliceGet } from './tabs-slice-contract'
import { findSiblingGroupId } from '../../../../../shared/workspace-layout/tab-group-layout-tree'
import { createTabsCreateActions } from './tabs-create-actions'
import { createTabsFocusActions } from './tabs-focus-actions'
import { createTabsCloseActions } from './tabs-close-actions'
import { createTabsBulkCloseActions } from './tabs-bulk-close-actions'
import { createTabsLabelActions } from './tabs-label-actions'
import { createTabsGroupActions } from './tabs-group-actions'
import { createTabsMoveActions } from './tabs-move-actions'
import { createTabsDropActions } from './tabs-drop-actions'
import { createTabsSplitRatioActions } from './tabs-split-ratio-actions'
import { createTabsDragPreviewActions } from './tabs-drag-preview-actions'
import { createTabsSessionActions } from './tabs-session-actions'
import { createTabsWorkspaceTransferActions } from './tabs-workspace-transfer'

export const createTabsSlice: StateCreator<AppState, [], [], TabsSlice> = (set, get) => ({
  unifiedTabsByWorktree: {},
  groupsByWorktree: {},
  activeGroupIdByWorktree: {},
  layoutByWorktree: {},
  ...createTabsCreateActions(set, get),
  ...createTabsFocusActions(set, get),
  ...createTabsCloseActions(set, get),
  ...createTabsBulkCloseActions(set, get),
  ...createTabsLabelActions(set, get),
  ...createTabsGroupActions(set, get),
  ...createTabsMoveActions(set, get),
  ...createTabsDropActions(set, get),
  ...createTabsSplitRatioActions(set),
  ...createTabsDragPreviewActions(set),
  ...createTabsMergeGroupIntoSiblingAction(get),
  ...createTabsSessionActions(set, get),
  ...createTabsWorkspaceTransferActions(set, get)
})

// Why: Agency's pane close merges a group into its sibling (WorkspacePaneCloseButton and
// remove-chat-pane-from-split). Stable deleted this action as unused, so it is kept here
// until the tabs slice contract declares it.
function createTabsMergeGroupIntoSiblingAction(get: TabsSliceGet): {
  mergeGroupIntoSibling: (worktreeId: string, groupId: string) => string | null
} {
  return {
    mergeGroupIntoSibling: (worktreeId, groupId) => {
      const state = get()
      const groups = state.groupsByWorktree[worktreeId] ?? []
      const sourceGroup = groups.find((candidate) => candidate.id === groupId)
      const layout = state.layoutByWorktree[worktreeId]
      if (!sourceGroup || !layout || groups.length <= 1) {
        return null
      }
      const targetGroupId = findSiblingGroupId(layout, groupId)
      if (!targetGroupId) {
        return null
      }

      const orderedSourceTabs = (state.unifiedTabsByWorktree[worktreeId] ?? []).filter(
        (tab) => tab.groupId === groupId
      )
      for (const tabId of sourceGroup.tabOrder) {
        const item = orderedSourceTabs.find((tab) => tab.id === tabId)
        if (!item) {
          continue
        }
        get().moveUnifiedTabToGroup(item.id, targetGroupId, { recordInteraction: false })
      }
      get().closeEmptyGroup(worktreeId, groupId)
      get().recordFeatureInteraction?.('terminal-panes')
      return targetGroupId
    }
  }
}
