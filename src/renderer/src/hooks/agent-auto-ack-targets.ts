import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../shared/constants'
import { isOrcaWindowForegroundFocused } from '@/components/terminal-pane/terminal-notification-pane-visibility'
import { isStructuredTab } from '../../../shared/agent-session/view/structured-agent-session-tab'
import type { Tab, TabGroup, TabGroupLayoutNode } from '../../../shared/tab-types'
import type { TerminalTab } from '../../../shared/terminal-tab-types'
import type { SessionGridFilter } from '../../../shared/session-grid-types'
import { collectTabGroupLayoutGroupIds } from '../../../shared/workspace-layout/tab-group-moves'
import { isPresenceConfirmed } from './agent-auto-ack-presence'
import {
  selectFloatingWorkspacePanelVisible,
  type FloatingWorkspacePanelVisibilityState
} from '@/store/floating-workspace-panel-selector'

export type AutoAckTabTarget = {
  tabId: string
  worktreeId: string | null
  /** Which adapter owns `tabId`: a terminal tab id, or a structured chat's unified tab id. */
  surfaceKind: 'terminal' | 'structured'
  viewOrigin?: 'session-grid'
}

export type AutoAckTargetState = FloatingWorkspacePanelVisibilityState & {
  activeView: string
  activeWorktreeId: string | null
  activeSessionGridWorktreeId?: string | null
  activeSessionGridTabId: string | null
  sessionsGridFilter: SessionGridFilter
  sessionsGridHiddenTabIds: readonly string[]
  tabsByWorktree: Record<string, TerminalTab[]>
  layoutByWorktree?: Readonly<Record<string, TabGroupLayoutNode | undefined>>
  groupsByWorktree: Readonly<Record<string, readonly Pick<TabGroup, 'id' | 'activeTabId'>[]>>
  activeGroupIdByWorktree: Readonly<Record<string, string | null | undefined>>
  unifiedTabsByWorktree: Readonly<Record<string, readonly Tab[]>>
}

/** The one session-grid card on the board, owned by its worktree; hidden or filtered-out cards are not seen. */
function sessionGridSelectionOnTheBoard(
  state: AutoAckTargetState,
  tabId: string
): AutoAckTabTarget | null {
  if (state.sessionsGridHiddenTabIds.includes(tabId)) {
    return null
  }
  let worktreeId = state.activeSessionGridWorktreeId
  if (worktreeId == null) {
    const owners = Object.keys(state.tabsByWorktree).filter((id) =>
      state.tabsByWorktree[id].some((tab) => tab.id === tabId)
    )
    if (owners.length !== 1) {
      return null
    }
    worktreeId = owners[0]
  }
  if (!worktreeId || !state.tabsByWorktree[worktreeId]?.some((tab) => tab.id === tabId)) {
    return null
  }
  const filter = state.sessionsGridFilter
  if (
    filter !== 'all' &&
    (state.tabsByWorktree[filter]?.length ?? 0) > 0 &&
    worktreeId !== filter
  ) {
    return null
  }
  return { tabId, worktreeId, surfaceKind: 'terminal', viewOrigin: 'session-grid' }
}

/** Collect visible split groups, focused first; unified selection wins because chat can replace a terminal whose legacy active ID still names hidden content. */
function resolveWorkspaceAutoAckTargets(
  state: AutoAckTargetState,
  worktreeId: string
): AutoAckTabTarget[] {
  const groups = state.groupsByWorktree[worktreeId] ?? []
  const focusedGroupId = state.activeGroupIdByWorktree[worktreeId] ?? groups[0]?.id
  const groupIds = new Set(focusedGroupId ? [focusedGroupId] : [])
  collectTabGroupLayoutGroupIds(state.layoutByWorktree?.[worktreeId], groupIds)
  const tabs = state.unifiedTabsByWorktree[worktreeId] ?? []
  const targets: AutoAckTabTarget[] = []
  for (const groupId of groupIds) {
    const activeTabId = groups.find((group) => group.id === groupId)?.activeTabId
    const tab = activeTabId ? tabs.find((candidate) => candidate.id === activeTabId) : undefined
    if (tab && isStructuredTab(tab)) {
      targets.push({ tabId: tab.id, worktreeId, surfaceKind: 'structured' })
    } else if (tab?.contentType === 'terminal') {
      targets.push({ tabId: tab.entityId, worktreeId, surfaceKind: 'terminal' })
    }
  }
  return targets
}

/**
 * Surfaces whose visible content counts as "seen" right now, each paired with the worktree that
 * owns it.
 *
 * Why the floating workspace is gated on panel visibility rather than `activeView`: the panel is an
 * overlay that sits above every view and stays mounted while closed, and its active tab never
 * becomes the global `activeTabId` — so neither the view nor the tab id can stand in for "on screen".
 * Session-grid cards add the one card the board shows, when the sessions view is active.
 */
export function resolveAutoAckTabTargets(
  state: AutoAckTargetState,
  options?: { floatingPanelVisible: boolean }
): AutoAckTabTarget[] {
  const targets: AutoAckTabTarget[] = []
  if (options?.floatingPanelVisible ?? selectFloatingWorkspacePanelVisible(state)) {
    // The floating pane is on top when two worktrees claim the same tab ID.
    targets.push(...resolveWorkspaceAutoAckTargets(state, FLOATING_TERMINAL_WORKTREE_ID))
  }
  if (state.activeView === 'terminal' && state.activeWorktreeId) {
    for (const target of resolveWorkspaceAutoAckTargets(state, state.activeWorktreeId)) {
      if (!targets.some((existing) => existing.tabId === target.tabId)) {
        targets.push(target)
      }
    }
  }
  if (state.activeView === 'sessions' && state.activeSessionGridTabId) {
    const gridTarget = sessionGridSelectionOnTheBoard(state, state.activeSessionGridTabId)
    if (gridTarget && !targets.some((target) => target.tabId === gridTarget.tabId)) {
      targets.push(gridTarget)
    }
  }
  return targets
}

export function onScreenWorkspaceIds(state: AutoAckTargetState): string[] {
  const workspaceIds = selectFloatingWorkspacePanelVisible(state)
    ? [FLOATING_TERMINAL_WORKTREE_ID]
    : []
  if (state.activeView === 'terminal' && state.activeWorktreeId) {
    workspaceIds.push(state.activeWorktreeId)
  }
  if (state.activeView === 'sessions' && state.activeSessionGridTabId) {
    const selected = sessionGridSelectionOnTheBoard(state, state.activeSessionGridTabId)
    if (selected?.worktreeId && !workspaceIds.includes(selected.worktreeId)) {
      workspaceIds.push(selected.worktreeId)
    }
  }
  return workspaceIds
}

export function isWorkspaceOnScreen(state: AutoAckTargetState, workspaceId: string): boolean {
  return (
    isOrcaWindowForegroundFocused() &&
    isPresenceConfirmed() &&
    onScreenWorkspaceIds(state).includes(workspaceId)
  )
}

/** Use the scan’s visibility/focus/presence gate so marking skips exactly the attention the scan would immediately acknowledge. */
export function isTabOnScreen(
  state: AutoAckTargetState,
  worktreeId: string,
  tabId: string,
  surfaceKind: AutoAckTabTarget['surfaceKind']
): boolean {
  return (
    isOrcaWindowForegroundFocused() &&
    isPresenceConfirmed() &&
    resolveAutoAckTabTargets(state).some(
      (target) =>
        target.surfaceKind === surfaceKind &&
        target.tabId === tabId &&
        target.worktreeId === worktreeId
    )
  )
}
