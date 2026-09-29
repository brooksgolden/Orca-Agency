import type { AiVaultSession } from '../../../../shared/ai-vault-types'
import { isPathInsideOrEqual } from '../../../../shared/cross-platform-path'
import { isClaudeTranscriptInProjectBucket } from '../../../../shared/claude-project-path'
import type { ChatSidebarRow } from './chat-sidebar-types'

/**
 * The session to resume from the chat list: a chat filed under another workspace starts in that
 * workspace's folder, on its own host. Only this list does it; AI Vault resumes where the chat ran.
 */
export function chatResumeSession(
  row: Pick<ChatSidebarRow, 'session' | 'hostId' | 'worktree'>
): AiVaultSession | null {
  const session = row.session
  const target = row.worktree.path.trim()
  if (
    !session ||
    !target ||
    session.executionHostId !== row.hostId ||
    // Why: a chat recorded in this workspace or a subfolder keeps the exact folder it ran in.
    (session.cwd && isPathInsideOrEqual(target, session.cwd))
  ) {
    return session
  }
  // Why: Claude finds transcripts by launch folder; moving the folder without the transcript finds nothing.
  if (session.agent === 'claude' && !isClaudeTranscriptInProjectBucket(session.filePath, target)) {
    return session
  }
  // Why: a host-built resume command embeds the old folder, so the local builder must run instead.
  return { ...session, cwd: target, resumeCommand: '' }
}
