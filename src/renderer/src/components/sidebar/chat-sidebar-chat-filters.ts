import type { ChatSidebarSettings, ChatStateChecks } from '../../../../shared/chat-sidebar-settings'
import type { ChatSidebarRow } from './chat-sidebar-types'

export type ResolvedChatStateChecks = {
  doneClosed: boolean
  doneOpen: boolean
  idle: boolean
}

// Why: a saved Hide Done or Collapse Done flag from before the menus existed means both Done states.
function resolveChecks(
  checks: ChatStateChecks | undefined,
  legacyDone: boolean | undefined
): ResolvedChatStateChecks {
  if (checks) {
    return {
      doneClosed: checks.doneClosed === true,
      doneOpen: checks.doneOpen === true,
      idle: checks.idle === true
    }
  }
  const done = legacyDone === true
  return { doneClosed: done, doneOpen: done, idle: false }
}

export function resolveHideChats(settings: ChatSidebarSettings | undefined) {
  return resolveChecks(settings?.hideChats, settings?.showOnlyInProgress)
}

export function resolveCollapseFolders(settings: ChatSidebarSettings | undefined) {
  return resolveChecks(settings?.collapseFolders, settings?.collapseDoneFolders)
}

/** Legacy flag written beside the new checks: true only when both Done states are checked. */
export function legacyDoneFlag(checks: ResolvedChatStateChecks): boolean {
  return checks.doneClosed && checks.doneOpen
}

/**
 * Match the rendered marker: explicit completion is white; reported completion is green. Idle is the grey idle dot on a
 * non-Done row; a focused or on-screen idle chat is never counted, so it cannot be hidden or collapsed.
 */
export function chatInCheckedState(
  row: Pick<ChatSidebarRow, 'completed' | 'tabId' | 'displayState' | 'state'>,
  checks: ResolvedChatStateChecks,
  visibleTabIds: ReadonlySet<string> | undefined
): boolean {
  if (row.completed) {
    return checks.doneClosed
  }
  if ((row.displayState ?? row.state) === 'done') {
    return checks.doneOpen
  }
  if (!checks.idle || (row.displayState ?? row.state) !== 'idle') {
    return false
  }
  return !(row.tabId && visibleTabIds?.has(row.tabId))
}

export function hasAnyCheck(checks: ResolvedChatStateChecks): boolean {
  return checks.doneClosed || checks.doneOpen || checks.idle
}
