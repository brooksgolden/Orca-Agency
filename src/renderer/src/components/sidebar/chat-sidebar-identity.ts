import type {
  ChatSidebarCompletion,
  ChatSidebarSettings
} from '../../../../shared/chat-sidebar-settings'
import type { ChatSidebarRow } from './chat-sidebar-types'
import {
  chatLiveSessionSnapshot,
  chatSessionSnapshot,
  freshestChatSnapshot,
  sameChatSessionSnapshot
} from './chat-sidebar-session-snapshot'

type RowIds = Pick<ChatSidebarRow, 'id' | 'aliases'>

function storedKey(values: Record<string, unknown>, row: RowIds): string | undefined {
  return [row.id, ...row.aliases].find((id) => Object.hasOwn(values, id))
}

/** Reads a per-chat preference by current id, then by an id it was stored under earlier. */
export function chatPreference<T>(
  values: Record<string, T> | undefined,
  row: RowIds
): T | undefined {
  if (!values) {
    return undefined
  }
  const key = storedKey(values, row)
  return key === undefined ? undefined : values[key]
}

export function isChatCompleted(
  row: Pick<ChatSidebarRow, 'turnStartedAt' | 'activityFromState' | 'state' | 'worktree'>,
  completion: ChatSidebarCompletion | undefined
): boolean {
  if (!completion) {
    return row.worktree.workspaceStatus === 'completed' && row.state !== 'working'
  }
  return (
    completion.done !== false &&
    row.turnStartedAt <= completion.at &&
    // Why: title-derived rows have no turn clock; a working title after the marked turn is a new turn.
    (!row.activityFromState || row.state !== 'working' || completion.working === true)
  )
}

function moveAliases<T>(values: Record<string, T>, row: RowIds, target: string): boolean {
  let changed = false
  for (const alias of row.aliases) {
    if (!Object.hasOwn(values, alias)) {
      continue
    }
    if (!Object.hasOwn(values, target)) {
      values[target] = values[alias]
    }
    delete values[alias]
    changed = true
  }
  return changed
}

/** Persists what rows learned since the last write: session registry, identity moves and title-only turns. */
export function chatSidebarPreferencePatch(
  rows: readonly ChatSidebarRow[],
  current: ChatSidebarSettings,
  now: number,
  /** Background recording without history: only rows that can snapshot themselves. */
  options: { liveOnly?: boolean } = {}
): Partial<ChatSidebarSettings> | null {
  const sessions = { ...current.sessions }
  const titles = { ...current.titles }
  const completed = { ...current.completed }
  let sessionsChanged = false
  let titlesChanged = false
  let completedChanged = false
  for (const row of rows) {
    if (options.liveOnly && !chatLiveSessionSnapshot(row, now)) {
      continue
    }
    if (row.sessionKey) {
      const stored = sessions[row.sessionKey]
      const ownsWorkspaceName =
        row.ownsWorkspaceName ||
        (stored?.worktreeId === row.worktree.id && stored.ownsWorkspaceName === true)
      const snapshot = freshestChatSnapshot(
        row.session ? chatSessionSnapshot(row.session) : stored?.snapshot,
        chatLiveSessionSnapshot(row, now),
        // Why: working rows carry their turn start and done rows their finish; both are real events.
        row.state !== 'working' && row.state !== 'done'
      )
      if (
        stored?.worktreeId !== row.worktree.id ||
        (stored.ownsWorkspaceName === true) !== ownsWorkspaceName ||
        (snapshot !== undefined && !sameChatSessionSnapshot(stored.snapshot, snapshot))
      ) {
        sessions[row.sessionKey] = {
          worktreeId: row.worktree.id,
          ...(ownsWorkspaceName ? { ownsWorkspaceName: true } : {}),
          ...(snapshot ? { snapshot } : {})
        }
        sessionsChanged = true
      }
      titlesChanged = moveAliases(titles, row, row.sessionKey) || titlesChanged
      completedChanged = moveAliases(completed, row, row.sessionKey) || completedChanged
    }
    if (!row.activityFromState) {
      continue
    }
    const key = storedKey(completed, row)
    const completion = key === undefined ? undefined : completed[key]
    if (!key || !completion || completion.done === false) {
      continue
    }
    if (completion.working === true && row.state !== 'working') {
      completed[key] = { ...completion, working: false }
      completedChanged = true
    } else if (completion.working !== true && row.state === 'working') {
      completed[key] = { ...completion, at: now, done: false }
      completedChanged = true
    }
  }
  if (!sessionsChanged && !titlesChanged && !completedChanged) {
    return null
  }
  return {
    ...(sessionsChanged ? { sessions } : {}),
    ...(titlesChanged ? { titles } : {}),
    ...(completedChanged ? { completed } : {})
  }
}
