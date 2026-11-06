import type { AppState } from '@/store/types'
import { collectWorkspacePanes, placeWorkspaceSurface } from '@/lib/workspace-group-layout'
import { effectiveWorkspaceLayouts } from '@/lib/workspace-surface-state'
import { toVisibleTabType } from '../../../../shared/tab-types'
import { useAppStore } from '@/store'
import { activateAndRevealWorkspace } from '@/lib/worktree-activation'
import { buildChatSidebarRows, chatSidebarWorktrees } from '../sidebar/chat-sidebar-rows'
import { detachSidebarChat } from '../sidebar/chat-sidebar-detach'
import type { WorkspacePanePlacement } from '@/lib/workspace-pane-placement'
import {
  findWorkspaceSplitGroup,
  MAX_WORKSPACE_PANES,
  type WorkspaceSplitEdge
} from '@/lib/workspace-split-layout'

export function tabMovesWithinWindow(
  state: AppState,
  sourceId: string,
  targetId: string,
  contentType: string
): boolean {
  const source = findWorkspaceSplitGroup(state.workspaceSplitGroups, sourceId)
  const target = findWorkspaceSplitGroup(state.workspaceSplitGroups, targetId)
  return (
    contentType !== 'terminal' ||
    sourceId === targetId ||
    Boolean(source && target && source.id === target.id)
  )
}

export function canDropTabAtWorkspaceEdge(sourceId: string, unifiedTabId: string): boolean {
  const state = useAppStore.getState()
  const tab = state.unifiedTabsByWorktree[sourceId]?.find((item) => item.id === unifiedTabId)
  if (!tab || (tab.contentType !== 'terminal' && toVisibleTabType(tab.contentType) !== 'editor')) {
    return false
  }
  // Check chat detach eligibility only at commit, never rescan the sidebar on every pointermove.
  return true
}

/** Different folders share panes, never a tab group. A multi-chat source moves just the dragged chat. */
export async function dropTabAtWorkspaceEdge(args: {
  sourceId: string
  unifiedTabId: string
  targetId: string
  edge: WorkspaceSplitEdge
  wholeWindow: boolean
  placement?: WorkspacePanePlacement
  targetGroupId?: string
}): Promise<void> {
  const state = useAppStore.getState()
  const tab = state.unifiedTabsByWorktree[args.sourceId]?.find(
    (item) => item.id === args.unifiedTabId
  )
  if (!tab || !canDropTabAtWorkspaceEdge(args.sourceId, args.unifiedTabId)) {
    throw new Error('This tab is no longer in its source pane.')
  }
  const targetExists = () =>
    chatSidebarWorktrees(useAppStore.getState()).some(
      (item) => item.id === args.targetId && !item.isArchived
    )
  if (!targetExists()) {
    throw new Error('The destination workspace was closed.')
  }
  if (tabMovesWithinWindow(state, args.sourceId, args.targetId, tab.contentType)) {
    if (
      !state.placeWorkspaceSurface(
        { type: 'leaf', workspaceId: args.sourceId, groupId: tab.groupId },
        { type: 'leaf', workspaceId: args.targetId, groupId: args.targetGroupId },
        args.edge,
        { wholeWindow: args.wholeWindow, placement: args.placement, unifiedTabId: tab.id }
      )
    ) {
      throw new Error('The pane changed or the split is full. Your document has been kept intact.')
    }
    return
  }
  const split = findWorkspaceSplitGroup(state.workspaceSplitGroups, args.targetId)
  const detaching = (state.tabsByWorktree[args.sourceId]?.length ?? 0) > 1
  if (
    split &&
    (detaching ||
      !collectWorkspacePanes(split.layout)
        .map((pane) => pane.workspaceId)
        .includes(args.sourceId)) &&
    collectWorkspacePanes(split.layout).map((pane) => pane.workspaceId).length >=
      MAX_WORKSPACE_PANES
  ) {
    throw new Error(`A split can contain up to ${MAX_WORKSPACE_PANES} workspaces`)
  }
  const dryRun = placeWorkspaceSurface(
    state.workspaceSplitGroups,
    effectiveWorkspaceLayouts(state),
    { type: 'leaf', workspaceId: detaching ? 'drag:terminal' : args.sourceId },
    { type: 'leaf', workspaceId: args.targetId, groupId: args.targetGroupId },
    args.edge,
    'drag:check',
    args.wholeWindow,
    args.placement
  )
  if (!dryRun) {
    throw new Error('This split cannot accept the chat. Its original pane has been kept intact.')
  }
  let sourceId = args.sourceId
  if (detaching) {
    const row = buildChatSidebarRows(state, [], Date.now()).find(
      (item) => item.tabId === tab.entityId
    )
    if (!row) {
      throw new Error('This terminal has no chat to move.')
    }
    sourceId = await detachSidebarChat(row, false)
  }
  if (!targetExists()) {
    throw new Error('The destination workspace was closed. Your chat remains separate.')
  }
  const currentSplit = findWorkspaceSplitGroup(
    useAppStore.getState().workspaceSplitGroups,
    args.targetId
  )
  if (
    currentSplit &&
    !collectWorkspacePanes(currentSplit.layout)
      .map((pane) => pane.workspaceId)
      .includes(sourceId) &&
    collectWorkspacePanes(currentSplit.layout).map((pane) => pane.workspaceId).length >=
      MAX_WORKSPACE_PANES
  ) {
    throw new Error(
      `A split can contain up to ${MAX_WORKSPACE_PANES} workspaces. Your chat remains separate.`
    )
  }
  if (
    activateAndRevealWorkspace(sourceId, {
      executionHostId: tab.executionHostId ?? 'local',
      revealInSidebar: false,
      providesInitialSurface: true
    }) !== false
  ) {
    const moved = useAppStore
      .getState()
      .placeWorkspaceSurface(
        { type: 'leaf', workspaceId: sourceId },
        { type: 'leaf', workspaceId: args.targetId, groupId: args.targetGroupId },
        args.edge,
        { wholeWindow: args.wholeWindow, placement: args.placement }
      )
    if (!moved) {
      throw new Error(
        'The destination changed. Your chat remains available in its separate workspace.'
      )
    }
  }
}
