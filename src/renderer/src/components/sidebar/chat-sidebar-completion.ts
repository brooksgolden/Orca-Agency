import type {
  ChatSidebarCompletion,
  ChatSidebarSettings
} from '../../../../shared/chat-sidebar-settings'
import type { ChatSidebarRow } from './chat-sidebar-types'

type CompletionRow = Pick<ChatSidebarRow, 'tabId' | 'turnStartedAt' | 'activityFromState' | 'state'>

function reopenedClosedChat(row: CompletionRow, completion: ChatSidebarCompletion): boolean {
  return Boolean(completion.closedTabId && row.tabId && row.tabId !== completion.closedTabId)
}

export function isChatCompleted(
  row: CompletionRow & Pick<ChatSidebarRow, 'worktree'>,
  completion: ChatSidebarCompletion | undefined
): boolean {
  if (!completion) {
    return row.worktree.workspaceStatus === 'completed' && row.state !== 'working'
  }
  return (
    completion.done !== false &&
    !reopenedClosedChat(row, completion) &&
    row.turnStartedAt <= completion.at &&
    // Why: title-derived rows have no turn clock; working after the marked turn is a new turn.
    (!row.activityFromState || row.state !== 'working' || completion.working === true)
  )
}

export function chatCompletionActivityTime(
  row: CompletionRow & Pick<ChatSidebarRow, 'completed' | 'timestamp'>,
  completion: ChatSidebarCompletion | undefined
): number {
  // Why: resume writes can advance the transcript timestamp without a new prompt.
  return completion &&
    (row.completed ||
      (reopenedClosedChat(row, completion) &&
        row.turnStartedAt <= completion.at &&
        !(row.activityFromState && row.state === 'working' && completion.working !== true)))
    ? completion.activityAt
    : row.timestamp
}

/** Persist a real prompt or replacement tab without treating resume as activity. */
export function refreshedChatCompletion(
  row: CompletionRow,
  completion: ChatSidebarCompletion,
  now: number
): ChatSidebarCompletion | null {
  if (row.turnStartedAt > completion.at && (completion.done !== false || completion.closedTabId)) {
    return { ...completion, closedTabId: undefined, done: false }
  }
  if (
    row.activityFromState &&
    row.state === 'working' &&
    completion.working !== true &&
    (completion.done !== false || completion.closedTabId)
  ) {
    return { ...completion, closedTabId: undefined, at: now, done: false }
  }
  if (completion.done === false) {
    return null
  }
  if (reopenedClosedChat(row, completion)) {
    return { ...completion, done: false }
  }
  if (row.activityFromState) {
    if (completion.working === true && row.state !== 'working') {
      return { ...completion, working: false }
    }
  }
  return null
}

export function chatCompletionEdit(
  row: Pick<ChatSidebarRow, 'id' | 'aliases' | 'timestamp' | 'state'>,
  current: ChatSidebarSettings,
  done: boolean,
  now: number
): Partial<ChatSidebarSettings> {
  const completed = { ...current.completed }
  for (const alias of row.aliases) {
    delete completed[alias]
  }
  completed[row.id] = {
    activityAt: row.timestamp,
    at: now,
    done,
    ...(row.state === 'working' ? { working: true } : {})
  }
  return { completed }
}
