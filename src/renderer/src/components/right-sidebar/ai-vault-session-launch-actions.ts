import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import {
  buildAiVaultResumeCopyCommandForWorktree,
  buildAiVaultResumeStartupForWorktree
} from '@/lib/ai-vault-resume-command'
import { launchAiVaultSessionInNewTab } from '@/lib/launch-ai-vault-session'
import { useAppStore } from '@/store'
import type { AiVaultAgent, AiVaultSession } from '../../../../shared/ai-vault-types'
import { isAiVaultTitleAgent } from '../../../../shared/ai-vault-session-title'
import { prepareAiVaultSessionForResume } from '@/lib/ai-vault-session-resume-preparation'
import type { Worktree } from '../../../../shared/worktree/types'
import { translate } from '@/i18n/i18n'
import { agentLabel } from './ai-vault-session-filters'
import type { AiVaultSessionResumeTargetState } from './ai-vault-session-resume'
import { prepareAiVaultSessionContinuation } from './ai-vault-session-continuation'
import type { AgentSessionContinuationRequest } from '@/lib/agent-session-continuation'
import { activateAiVaultStructuredSession } from '@/lib/activate-ai-vault-structured-session'
import { isAgentSessionHandleProvider } from '../../../../shared/agent-session-provider-handle'
import {
  activateAiVaultResumeWorkspace,
  resumeAiVaultSessionInNewChat
} from './ai-vault-session-resume-in-chat-launch'
import {
  aiVaultResumeUnsupportedMessage,
  resolveAiVaultSessionLaunchTarget,
  resolveAiVaultTargetWorkspacePath
} from './ai-vault-session-launch-target'
import type { TabSplitDirection } from '@/store/slices/tabs'

export type AiVaultResumePlacement = {
  targetGroupId?: string
  splitDirection?: TabSplitDirection
  onResumed?: () => void
  validateDestination?: () => boolean
  onSettled?: (outcome: 'created' | 'not-created' | 'unverifiable') => void
}

// Why module scope: the chat sidebar and AI Vault panel can resume the same session.
const pendingResumes = new Set<string>()
const RESUME_SETTLE_MS = 10_000

export function useAiVaultSessionLaunchActions({
  activeWorktree,
  activeWorktreeId,
  targetState,
  agentCmdOverrides
}: {
  activeWorktree: Worktree | null
  activeWorktreeId: string | null
  targetState: AiVaultSessionResumeTargetState
  agentCmdOverrides?: Partial<Record<AiVaultAgent, string | null>>
}) {
  const [continuationRequest, setContinuationRequest] =
    useState<AgentSessionContinuationRequest | null>(null)

  const buildResumeCommand = useCallback(
    (session: AiVaultSession, worktreeId?: string | null): string =>
      buildAiVaultResumeCopyCommandForWorktree({
        state: useAppStore.getState(),
        worktreeId: worktreeId ?? activeWorktreeId ?? activeWorktree?.id ?? null,
        session,
        commandOverride: agentCmdOverrides?.[session.agent]
      }),
    [activeWorktree?.id, activeWorktreeId, agentCmdOverrides]
  )

  const buildResumeStartup = useCallback(
    (session: AiVaultSession, worktreeId?: string | null) =>
      buildAiVaultResumeStartupForWorktree({
        state: useAppStore.getState(),
        worktreeId: worktreeId ?? activeWorktreeId ?? activeWorktree?.id ?? null,
        session,
        commandOverride: agentCmdOverrides?.[session.agent]
      }),
    [activeWorktree?.id, activeWorktreeId, agentCmdOverrides]
  )

  const copyResumeCommand = useCallback(
    async (session: AiVaultSession, worktreeId?: string | null): Promise<void> => {
      if (session.structuredSession) {
        return
      }
      try {
        const preparedSession = await prepareAiVaultSessionForResume(session)
        await window.api.ui.writeClipboardText(buildResumeCommand(preparedSession, worktreeId))
        toast.success(
          translate(
            'auto.components.right.sidebar.AiVaultPanel.resumeCommandCopied',
            'Resume command copied'
          )
        )
      } catch (error) {
        notifyAiVaultSessionPreparationFailure(error)
      }
    },
    [buildResumeCommand]
  )

  const handleResume = useCallback(
    (
      session: AiVaultSession,
      targetWorktreeId?: string,
      placement?: AiVaultResumePlacement
    ): void => {
      if (session.structuredSession) {
        void activateAiVaultStructuredSession(session).finally(() =>
          placement?.onSettled?.('created')
        )
        return
      }
      const targetId = resolveAiVaultSessionLaunchTargetOrNotify({
        sessionFilePath: session.filePath,
        sessionExecutionHostId: session.executionHostId,
        activeWorktreeId: activeWorktreeId ?? activeWorktree?.id ?? null,
        targetWorktreeId,
        targetState: targetWorktreeId ? useAppStore.getState() : targetState
      })
      if (!targetId) {
        placement?.onSettled?.('not-created')
        return
      }

      const resumeKey = JSON.stringify([session.executionHostId, session.agent, session.sessionId])
      if (pendingResumes.has(resumeKey)) {
        placement?.onSettled?.('not-created')
        if (placement) {
          toast.info('This chat is already reopening. Drop it again once it opens.')
        }
        return
      }
      pendingResumes.add(resumeKey)
      let settleMs = 0
      let resumeOutcome: 'created' | 'not-created' | 'unverifiable' = 'not-created'

      const showQueuedToast = (): void => {
        toast.success(
          translate(
            'auto.components.right.sidebar.AiVaultPanel.agentSessionQueued',
            '{{value0}} session queued',
            { value0: agentLabel(session.agent) }
          )
        )
      }
      void prepareAiVaultSessionForResume(session)
        .then(async (preparedSession) => {
          if (placement?.validateDestination && !placement.validateDestination()) {
            throw new Error('The destination pane was closed. Drop the chat onto an open pane.')
          }
          if (
            placement?.targetGroupId &&
            !useAppStore
              .getState()
              .groupsByWorktree[targetId.worktreeId]?.some(
                (group) => group.id === placement.targetGroupId
              )
          ) {
            throw new Error('The destination pane was closed. Drop the chat onto an open pane.')
          }
          const launchResult = launchAiVaultSessionInNewTab({
            agent: session.agent,
            worktreeId: targetId.worktreeId,
            ...buildResumeStartup(preparedSession, targetId.worktreeId),
            targetGroupId: placement?.targetGroupId,
            splitDirection: placement?.splitDirection
          })
          if (launchResult.tabId === null) {
            resumeOutcome = 'unverifiable'
            const outcome = await launchResult.runtimeLaunch
            if (outcome.status === 'failed') {
              toast.error(
                outcome.message ||
                  translate(
                    'auto.lib.launch.agent.in.new.tab.11cce5cc77',
                    'Could not launch {{value0}} in a new terminal.',
                    { value0: agentLabel(session.agent) }
                  )
              )
              return
            }
          } else {
            resumeOutcome = 'created'
            linkResumedTab(launchResult.tabId, session)
          }
          resumeOutcome = 'created'
          // Why: until the agent reports its session, a repeat click must not start a second copy.
          settleMs = RESUME_SETTLE_MS
          if (useAppStore.getState().activeWorktreeId !== targetId.worktreeId) {
            activateAiVaultResumeWorkspace(targetId.worktreeId)
          }
          placement?.onResumed?.()
          showQueuedToast()
        })
        .catch(notifyAiVaultSessionPreparationFailure)
        .finally(() => {
          setTimeout(() => pendingResumes.delete(resumeKey), settleMs)
          placement?.onSettled?.(resumeOutcome)
        })
    },
    [activeWorktree?.id, activeWorktreeId, buildResumeStartup, targetState]
  )

  const handleResumeInNewChat = useCallback(
    (session: AiVaultSession, targetWorktreeId?: string): void => {
      if (!isAgentSessionHandleProvider(session.agent)) {
        return
      }
      const worktreeId = targetWorktreeId ?? activeWorktreeId ?? activeWorktree?.id ?? null
      if (!worktreeId) {
        toast.error(
          translate(
            'auto.components.right.sidebar.AiVaultPanel.openWorkspaceBeforeResuming',
            'Open a workspace before resuming a session.'
          )
        )
        return
      }
      void resumeAiVaultSessionInNewChat(session, session.agent, worktreeId)
    },
    [activeWorktree?.id, activeWorktreeId]
  )

  const handleContinueInNewSession = useCallback(
    (session: AiVaultSession, targetWorktreeId: string): void => {
      const targetId = resolveAiVaultSessionLaunchTargetOrNotify({
        sessionFilePath: session.filePath,
        sessionExecutionHostId: session.executionHostId,
        activeWorktreeId: activeWorktreeId ?? activeWorktree?.id ?? null,
        targetWorktreeId,
        targetState
      })
      if (!targetId) {
        return
      }

      const targetWorkspacePath = resolveAiVaultTargetWorkspacePath(
        targetState,
        targetId.worktreeId
      )
      if (!targetWorkspacePath) {
        toast.error(
          translate(
            'auto.components.right.sidebar.AiVaultPanel.openWorkspaceBeforeResuming',
            'Open a workspace before resuming a session.'
          )
        )
        return
      }
      setContinuationRequest(
        prepareAiVaultSessionContinuation({
          session,
          targetWorktreeId: targetId.worktreeId,
          targetWorkspacePath
        })
      )
    },
    [activeWorktree?.id, activeWorktreeId, targetState]
  )

  const handleContinuationDialogOpenChange = useCallback((open: boolean): void => {
    if (!open) {
      setContinuationRequest(null)
    }
  }, [])

  return {
    buildResumeStartup,
    copyResumeCommand,
    handleResume,
    handleResumeInNewChat,
    handleContinueInNewSession,
    continuationRequest,
    handleContinuationDialogOpenChange
  }
}

/** Seeds the provider link title sync adds once the agent reports, so the new tab is this chat now. */
function linkResumedTab(tabId: string, session: AiVaultSession): void {
  const title = session.title.trim()
  if (isAiVaultTitleAgent(session.agent) && title) {
    useAppStore
      .getState()
      .setAiVaultTabTitle(tabId, { agent: session.agent, sessionId: session.sessionId, title })
  }
}

function notifyAiVaultSessionPreparationFailure(error: unknown): void {
  toast.error(
    error instanceof Error
      ? error.message
      : translate(
          'auto.components.right.sidebar.AiVaultPanel.prepareSessionResumeFailed',
          'Could not prepare this session for resume.'
        )
  )
}

function resolveAiVaultSessionLaunchTargetOrNotify(
  args: Parameters<typeof resolveAiVaultSessionLaunchTarget>[0]
): Extract<ReturnType<typeof resolveAiVaultSessionLaunchTarget>, { status: 'ready' }> | null {
  const target = resolveAiVaultSessionLaunchTarget(args)
  if (target.status === 'missing') {
    toast.error(
      translate(
        'auto.components.right.sidebar.AiVaultPanel.openWorkspaceBeforeResuming',
        'Open a workspace before resuming a session.'
      )
    )
    return null
  }
  if (target.status === 'unsupported') {
    toast.error(aiVaultResumeUnsupportedMessage(target.targetStatus))
    return null
  }
  return target
}
