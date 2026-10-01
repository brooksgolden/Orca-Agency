import type { AppState } from '@/store'
import { getKnownExecutionHostIdForWorktree } from '@/lib/worktree-runtime-owner'
import type { ExecutionHostId } from '../../../../../shared/execution-host'
import type { AiVaultSessionTitle } from '../../../../../shared/ai-vault-session-title'
import { normalizeRuntimePathForComparison } from '../../../../../shared/cross-platform-path'
import { isTerminalLeafId, makePaneKey, parsePaneKey } from '../../../../../shared/stable-pane-id'
import { collectLeafIdsInOrder } from '../terminal-layout-leaf-ids'
import type {
  ChatSidebarResumeLauncher,
  ChatSidebarSessionSnapshot
} from '../../../../../shared/chat-sidebar-settings'

function samePath(a: string, b: string): boolean {
  return normalizeRuntimePathForComparison(a) === normalizeRuntimePathForComparison(b)
}

function transcriptDirectory(path: string): string | null {
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return slash < 0 ? null : normalizeRuntimePathForComparison(path.slice(0, slash))
}

function matchesLauncherOrTarget(
  session: { id: string; transcriptPath?: string },
  proof: ChatSidebarResumeLauncher,
  targetId: string,
  targetPath: string
): boolean {
  return session.id === proof.sessionId
    ? Boolean(session.transcriptPath && samePath(session.transcriptPath, proof.transcriptPath))
    : session.id === targetId &&
        (!session.transcriptPath || samePath(session.transcriptPath, targetPath))
}

/** A tab title identifies one conversation, never every leaf of a split terminal. */
export function savedTabResume(
  state: Pick<
    AppState,
    | 'tabsByWorktree'
    | 'terminalLayoutsByTabId'
    | 'settings'
    | 'repos'
    | 'worktreesByRepo'
    | 'folderWorkspaces'
    | 'projectGroups'
    | 'projects'
    | 'agentStatusByPaneKey'
    | 'sleepingAgentSessionsByPaneKey'
  >,
  worktreeId: string,
  tabId: string,
  executionHostId: ExecutionHostId | null | undefined,
  paneKey?: string
): (ChatSidebarSessionSnapshot & { resumeLauncher?: ChatSidebarResumeLauncher }) | null {
  const tab = state.tabsByWorktree[worktreeId]?.find((candidate) => candidate.id === tabId)
  const identity: AiVaultSessionTitle | null | undefined = tab?.aiVaultTitle
  if (!tab) {
    return null
  }
  const hostId = executionHostId ?? getKnownExecutionHostIdForWorktree(state, worktreeId)
  if (!hostId) {
    return null
  }
  const layoutRoot = state.terminalLayoutsByTabId?.[tabId]?.root
  const parsedPane = paneKey ? parsePaneKey(paneKey) : null
  const splitLeafIds = layoutRoot?.type === 'split' ? collectLeafIdsInOrder(layoutRoot) : null
  let titleBelongsToSplitSibling = false
  if (
    identity &&
    splitLeafIds &&
    parsedPane?.tabId === tabId &&
    splitLeafIds.includes(parsedPane.leafId)
  ) {
    titleBelongsToSplitSibling = splitLeafIds.some((leafId) => {
      if (leafId === parsedPane.leafId || !isTerminalLeafId(leafId)) {
        return false
      }
      const siblingKey = makePaneKey(tabId, leafId)
      const status = state.agentStatusByPaneKey[siblingKey]
      const sleeping = state.sleepingAgentSessionsByPaneKey[siblingKey]
      return Boolean(
        (status &&
          status.paneKey === siblingKey &&
          (!status.tabId || status.tabId === tabId) &&
          (!status.worktreeId || status.worktreeId === worktreeId) &&
          status.agentType === identity.agent &&
          status.providerSession?.id === identity.sessionId) ||
        (sleeping &&
          sleeping.paneKey === siblingKey &&
          (!sleeping.tabId || sleeping.tabId === tabId) &&
          sleeping.worktreeId === worktreeId &&
          sleeping.agent === identity.agent &&
          sleeping.providerSession.id === identity.sessionId)
      )
    })
  }
  if (paneKey) {
    const status = state.agentStatusByPaneKey[paneKey]
    const sleeping = state.sleepingAgentSessionsByPaneKey[paneKey]
    let proofForPane = false
    const proved = Object.entries(state.settings?.chatSidebar?.sessions ?? {}).flatMap(
      ([key, entry]) => {
        const proof = entry.resumeLauncher
        const snapshot = entry.snapshot
        if (
          proof?.tabId === tabId &&
          proof.paneKey === paneKey &&
          entry.worktreeId === worktreeId
        ) {
          proofForPane = true
        }
        if (
          !proof ||
          proof.agent !== 'claude' ||
          typeof proof.sessionId !== 'string' ||
          typeof proof.transcriptPath !== 'string' ||
          typeof proof.tabId !== 'string' ||
          typeof proof.paneKey !== 'string' ||
          typeof proof.targetSessionIdPrefix !== 'string' ||
          !/^[0-9a-f]{8}$/.test(proof.targetSessionIdPrefix) ||
          proof.tabId !== tabId ||
          proof.paneKey !== paneKey ||
          entry.worktreeId !== worktreeId ||
          !snapshot ||
          snapshot.agent !== 'claude' ||
          typeof snapshot.sessionId !== 'string' ||
          typeof snapshot.filePath !== 'string' ||
          snapshot.executionHostId !== hostId ||
          !snapshot.sessionId.startsWith(proof.targetSessionIdPrefix) ||
          !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(snapshot.sessionId) ||
          key !== JSON.stringify([hostId, 'claude', snapshot.sessionId]) ||
          !transcriptDirectory(proof.transcriptPath) ||
          transcriptDirectory(snapshot.filePath) !== transcriptDirectory(proof.transcriptPath) ||
          (identity &&
            !titleBelongsToSplitSibling &&
            (identity.agent !== 'claude' ||
              (identity.sessionId !== proof.sessionId &&
                identity.sessionId !== snapshot.sessionId))) ||
          (status &&
            (status.agentType !== 'claude' ||
              !status.providerSession ||
              (status.providerSession.id === proof.sessionId &&
                (typeof status.prompt !== 'string' || status.prompt.trim().length > 0)) ||
              !matchesLauncherOrTarget(
                status.providerSession,
                proof,
                snapshot.sessionId,
                snapshot.filePath
              ))) ||
          (sleeping &&
            (sleeping.agent !== 'claude' ||
              !matchesLauncherOrTarget(
                sleeping.providerSession,
                proof,
                snapshot.sessionId,
                snapshot.filePath
              )))
        ) {
          return []
        }
        return [{ ...snapshot, resumeLauncher: proof }]
      }
    )
    if (proved.length === 1) {
      return proved[0]
    }
    if (proofForPane) {
      return null
    }
  }
  // A tab title belongs to one conversation, while a split can hold many pane sessions.
  if (state.terminalLayoutsByTabId?.[tabId]?.root?.type === 'split') {
    return null
  }
  if (!identity?.sessionId) {
    return null
  }
  const key = JSON.stringify([hostId, identity.agent, identity.sessionId])
  const snapshot = state.settings?.chatSidebar?.sessions?.[key]?.snapshot
  if (
    !snapshot ||
    snapshot.executionHostId !== hostId ||
    snapshot.agent !== identity.agent ||
    snapshot.sessionId !== identity.sessionId
  ) {
    return null
  }
  return snapshot
}
