import {
  isAiVaultSessionResumableContent,
  type AiVaultSession
} from '../../../../shared/ai-vault-types'
import { normalizeRuntimePathForComparison } from '../../../../shared/cross-platform-path'
import type {
  ChatSidebarResumeLauncher,
  ChatSidebarSettings
} from '../../../../shared/chat-sidebar-settings'
import type { ExecutionHostId } from '../../../../shared/execution-host'
import { chatSessionKey } from './chat-sidebar-types'

function claudeTranscriptDirectory(filePath: string): string | null {
  const separator = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  return separator < 0 ? null : normalizeRuntimePathForComparison(filePath.slice(0, separator))
}

function sameTranscriptPath(a: string, b: string): boolean {
  return normalizeRuntimePathForComparison(a) === normalizeRuntimePathForComparison(b)
}

function claudeSessionMatchesPrefix(sessionId: string, prefix: string): boolean {
  return (
    sessionId.startsWith(prefix) && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(sessionId)
  )
}

export function resumedClaudeSession(
  launcher: AiVaultSession | null,
  sessions: ReadonlyMap<string, AiVaultSession>,
  reportedTranscriptPath: string | undefined
): AiVaultSession | null {
  const prefix = launcher?.resumedSessionIdPrefix
  const directory = launcher && claudeTranscriptDirectory(launcher.filePath)
  if (
    launcher?.agent !== 'claude' ||
    !reportedTranscriptPath ||
    !sameTranscriptPath(launcher.filePath, reportedTranscriptPath) ||
    !prefix ||
    !directory ||
    isAiVaultSessionResumableContent(launcher)
  ) {
    return null
  }
  const matches = [...sessions.values()].filter(
    (candidate) =>
      candidate.agent === 'claude' &&
      candidate.executionHostId === launcher.executionHostId &&
      claudeSessionMatchesPrefix(candidate.sessionId, prefix) &&
      claudeTranscriptDirectory(candidate.filePath) === directory &&
      isAiVaultSessionResumableContent(candidate)
  )
  return matches.length === 1 ? (matches[0] ?? null) : null
}

export function savedClaudeResume(args: {
  settings: ChatSidebarSettings | undefined
  sessions: ReadonlyMap<string, AiVaultSession>
  launcher: AiVaultSession | null
  launcherSessionId: string
  launcherTranscriptPath: string | undefined
  hostId: ExecutionHostId
  worktreeId: string
  tabId: string
  paneKey: string
}): { session: AiVaultSession; proof: ChatSidebarResumeLauncher } | null {
  const path = args.launcherTranscriptPath
  if (
    !path ||
    (args.launcher &&
      (isAiVaultSessionResumableContent(args.launcher) ||
        !sameTranscriptPath(args.launcher.filePath, path)))
  ) {
    return null
  }
  const directory = claudeTranscriptDirectory(path)
  const matches = Object.entries(args.settings?.sessions ?? {}).flatMap(([key, entry]) => {
    const proof = entry.resumeLauncher
    const snapshot = entry.snapshot
    if (
      !proof ||
      proof.agent !== 'claude' ||
      typeof proof.sessionId !== 'string' ||
      typeof proof.transcriptPath !== 'string' ||
      typeof proof.tabId !== 'string' ||
      typeof proof.paneKey !== 'string' ||
      typeof proof.targetSessionIdPrefix !== 'string' ||
      !/^[0-9a-f]{8}$/.test(proof.targetSessionIdPrefix) ||
      proof.sessionId !== args.launcherSessionId ||
      !sameTranscriptPath(proof.transcriptPath, path) ||
      proof.tabId !== args.tabId ||
      proof.paneKey !== args.paneKey ||
      entry.worktreeId !== args.worktreeId ||
      !snapshot ||
      snapshot.agent !== 'claude' ||
      snapshot.executionHostId !== args.hostId ||
      typeof snapshot.sessionId !== 'string' ||
      typeof snapshot.filePath !== 'string' ||
      !claudeSessionMatchesPrefix(snapshot.sessionId, proof.targetSessionIdPrefix) ||
      (args.launcher && args.launcher.resumedSessionIdPrefix !== proof.targetSessionIdPrefix) ||
      key !== chatSessionKey(args.hostId, 'claude', snapshot.sessionId) ||
      !directory ||
      claudeTranscriptDirectory(snapshot.filePath) !== directory
    ) {
      return []
    }
    const session = args.sessions.get(key)
    return session && sameTranscriptPath(session.filePath, snapshot.filePath)
      ? [{ session, proof }]
      : []
  })
  return matches.length === 1 ? (matches[0] ?? null) : null
}
