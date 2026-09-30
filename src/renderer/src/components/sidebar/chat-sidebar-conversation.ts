import {
  isAiVaultSessionResumableContent,
  type AiVaultSession
} from '../../../../shared/ai-vault-types'
import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import type { ChatSidebarSessionEntry } from '../../../../shared/chat-sidebar-settings'

/** A launched process or session id alone is not a conversation. */
export function hasChatConversation({
  session,
  saved,
  entry,
  providerTitle,
  savedPrompt
}: {
  session?: AiVaultSession | null
  saved?: ChatSidebarSessionEntry
  entry?: AgentStatusEntry
  providerTitle?: string | null
  savedPrompt?: string
}): boolean {
  // Why: /clear keeps old history and completed replies while assigning a new session id.
  const turn = entry?.sessionBoundary ? undefined : entry
  return Boolean(
    (session && isAiVaultSessionResumableContent(session)) ||
    saved?.snapshot ||
    savedPrompt?.trim() ||
    turn?.prompt.trim() ||
    (!turn?.lastAssistantMessageIsToolOutput && turn?.lastAssistantMessage?.trim()) ||
    providerTitle?.trim()
  )
}
