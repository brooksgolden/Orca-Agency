import type { UISlice, UISliceSet } from './ui-slice-contract'
import { createBrowserUuid } from '@/lib/browser-uuid'
import { placeWorkspaceSurface } from '@/lib/workspace-group-layout'
import { effectiveWorkspaceLayouts } from '@/lib/workspace-surface-state'
import { projectTabDrop } from '../tabs/tabs-drop-actions'
import { reconcileWorkspaceGroupLayouts } from '@/lib/workspace-group-reconciliation'
import {
  readWorkspaceSplitGroups,
  removeWorkspaceFromSplit,
  setWorkspaceSplitRatio,
  writeWorkspaceSplitGroups
} from '@/lib/workspace-split-layout'

export function createUiWorkspaceSurfaceActions(
  set: UISliceSet
): Pick<
  UISlice,
  | 'workspaceSplitGroups'
  | 'reconcileWorkspaceSurfaceGroups'
  | 'placeWorkspaceSurface'
  | 'placeWorkspacePane'
  | 'placeWorkspaceAtEdge'
  | 'unsplitWorkspace'
  | 'setWorkspaceSplitRatio'
> {
  return {
    workspaceSplitGroups: readWorkspaceSplitGroups(),
    reconcileWorkspaceSurfaceGroups: () =>
      set((state) => {
        const workspaceSplitGroups = reconcileWorkspaceGroupLayouts(
          state.workspaceSplitGroups,
          effectiveWorkspaceLayouts(state)
        )
        if (workspaceSplitGroups === state.workspaceSplitGroups) {
          return state
        }
        writeWorkspaceSplitGroups(workspaceSplitGroups)
        return { workspaceSplitGroups }
      }),
    placeWorkspaceSurface: (source, target, edge, options) => {
      let moved = false
      set((state) => {
        let patch = {}
        let working = state
        if (options?.unifiedTabId) {
          const tab = state.unifiedTabsByWorktree[source.workspaceId]?.find(
            (item) => item.id === options.unifiedTabId
          )
          const group = state.groupsByWorktree[source.workspaceId]?.find(
            (item) => item.id === tab?.groupId
          )
          if (!tab || !group) {
            return state
          }
          source = { type: 'leaf', workspaceId: source.workspaceId, groupId: group.id }
          if (group.tabOrder.length > 1) {
            const nextGroupId = createBrowserUuid()
            const projected = projectTabDrop(
              state,
              tab.id,
              { groupId: group.id, splitDirection: 'right' },
              nextGroupId
            )
            if (!projected) {
              return state
            }
            patch = projected
            working = { ...state, ...projected }
            source = { ...source, groupId: nextGroupId }
          }
        }
        const workspaceSplitGroups = placeWorkspaceSurface(
          working.workspaceSplitGroups,
          effectiveWorkspaceLayouts(working),
          source,
          target,
          edge,
          createBrowserUuid(),
          options?.wholeWindow,
          options?.placement
        )
        if (!workspaceSplitGroups) {
          return state
        }
        moved = true
        writeWorkspaceSplitGroups(workspaceSplitGroups)
        return { ...patch, workspaceSplitGroups }
      })
      return moved
    },
    placeWorkspacePane: (source, target, placement) =>
      set((state) => {
        const workspaceSplitGroups = placeWorkspaceSurface(
          state.workspaceSplitGroups,
          effectiveWorkspaceLayouts(state),
          { type: 'leaf', workspaceId: source },
          { type: 'leaf', workspaceId: target },
          'top',
          createBrowserUuid(),
          false,
          placement
        )
        if (!workspaceSplitGroups) {
          return state
        }
        writeWorkspaceSplitGroups(workspaceSplitGroups)
        return { workspaceSplitGroups }
      }),
    placeWorkspaceAtEdge: (source, target, edge, wholeWindow) =>
      set((state) => {
        const workspaceSplitGroups = placeWorkspaceSurface(
          state.workspaceSplitGroups,
          effectiveWorkspaceLayouts(state),
          { type: 'leaf', workspaceId: source },
          { type: 'leaf', workspaceId: target },
          edge,
          createBrowserUuid(),
          wholeWindow
        )
        if (!workspaceSplitGroups) {
          return state
        }
        writeWorkspaceSplitGroups(workspaceSplitGroups)
        return { workspaceSplitGroups }
      }),
    unsplitWorkspace: (workspaceId) =>
      set((state) => {
        const workspaceSplitGroups = removeWorkspaceFromSplit(
          state.workspaceSplitGroups,
          workspaceId
        )
        writeWorkspaceSplitGroups(workspaceSplitGroups)
        return { workspaceSplitGroups }
      }),
    setWorkspaceSplitRatio: (groupId, path, ratio) =>
      set((state) => {
        const workspaceSplitGroups = setWorkspaceSplitRatio(
          state.workspaceSplitGroups,
          groupId,
          path,
          ratio
        )
        writeWorkspaceSplitGroups(workspaceSplitGroups)
        return { workspaceSplitGroups }
      })
  }
}
