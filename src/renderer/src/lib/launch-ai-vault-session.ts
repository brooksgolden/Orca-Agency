import { useAppStore } from '@/store'
import { persistAgentLaunchTabOrder } from '@/lib/launch-agent-tab-order'
import { tuiAgentToAgentKind } from '@/lib/telemetry'
import {
  getExecutionHostIdForWorktree,
  runtimeEnvironmentIdOrLocalUnlessTwin
} from '@/lib/worktree-runtime-owner'
import { createWebRuntimeSessionTerminalWithIdentity } from '@/runtime/web-runtime-terminal-creation'
import { isWebRuntimeSessionActive } from '@/runtime/web-runtime-session-environment'
import { toWebTerminalSurfaceTabId } from '../../../shared/terminal-surface-id'
import { webTerminalPlacementParentTabId } from '@/runtime/web-session-terminal-placement'
import { updateChatSidebar } from '@/components/sidebar/chat-sidebar-preferences'
import { chatFallbackId } from '@/components/sidebar/chat-sidebar-types'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import type { AiVaultAgent } from '../../../shared/ai-vault-types'
import type {
  AgentProviderSessionMetadata,
  SleepingAgentLaunchConfig
} from '../../../shared/agent-session/lifecycle/agent-session-resume'
import type { TabSplitDirection } from '@/store/slices/tabs'
import type { WebRuntimeTerminalCreateOutcome } from '@/runtime/web-runtime-session-types'

export type LaunchAiVaultSessionInNewTabResult =
  | { tabId: string }
  | { tabId: null; runtimeLaunch: Promise<WebRuntimeTerminalCreateOutcome> }

function rememberUserResumedTab(hostId: string, tabId: string): void {
  const key = chatFallbackId(hostId, tabId)
  void updateChatSidebar((current) =>
    current.userResumedTabs?.includes(key)
      ? null
      : { userResumedTabs: [...(current.userResumedTabs ?? []), key] }
  ).catch(() =>
    toast.error(
      translate(
        'auto.lib.launchAiVaultSession.couldNotSaveResumedChat',
        'Could not save the resumed chat in Chats.'
      )
    )
  )
}

export function launchAiVaultSessionInNewTab(args: {
  agent: AiVaultAgent
  worktreeId: string
  command: string
  cwd?: string
  env?: Record<string, string>
  envToDelete?: string[]
  launchConfig?: SleepingAgentLaunchConfig
  providerSession?: AgentProviderSessionMetadata
  targetGroupId?: string
  splitDirection?: TabSplitDirection
}): LaunchAiVaultSessionInNewTabResult {
  const store = useAppStore.getState()
  const executionHostId = getExecutionHostIdForWorktree(store, args.worktreeId)
  // Why both paths split: the runtime path used to return first and drop the split (#22791).
  const split =
    args.splitDirection && args.targetGroupId
      ? { sourceGroupId: args.targetGroupId, splitDirection: args.splitDirection }
      : undefined
  const runtimeEnvironmentId = runtimeEnvironmentIdOrLocalUnlessTwin(store, args.worktreeId)
  if (isWebRuntimeSessionActive(runtimeEnvironmentId)) {
    // Why an empty group first: the paired host creates the tab after a round trip.
    const splitGroupId = split
      ? store.createEmptySplitGroup(args.worktreeId, split.sourceGroupId, split.splitDirection)
      : null
    const targetGroupId = splitGroupId ?? args.targetGroupId
    const runtimeLaunch = createWebRuntimeSessionTerminalWithIdentity({
      worktreeId: args.worktreeId,
      environmentId: runtimeEnvironmentId,
      ...(targetGroupId ? { targetGroupId } : {}),
      agentSessionKind: 'resume',
      launchAgent: args.agent,
      command: args.command,
      ...(args.cwd ? { cwd: args.cwd } : {}),
      ...(args.env ? { env: args.env } : {}),
      ...(args.envToDelete ? { envToDelete: args.envToDelete } : {}),
      ...(args.launchConfig ? { launchConfig: args.launchConfig } : {}),
      ...(args.providerSession ? { providerSession: args.providerSession } : {}),
      ...(args.launchConfig ? { agentArgs: args.launchConfig.agentArgs } : {}),
      activate: true
    })
    const observedRuntimeLaunch = runtimeLaunch.then(({ outcome, hostTabId }) => {
      if (outcome.status === 'created') {
        useAppStore.getState().setActiveTabType('terminal', args.worktreeId)
        if (hostTabId) {
          rememberUserResumedTab(
            executionHostId,
            toWebTerminalSurfaceTabId(webTerminalPlacementParentTabId(hostTabId))
          )
        }
      } else if (splitGroupId) {
        // A refused or failed drop must not leave a blank pane behind.
        useAppStore.getState().closeEmptyGroup(args.worktreeId, splitGroupId)
      }
      return outcome
    })
    return { tabId: null, runtimeLaunch: observedRuntimeLaunch }
  }

  const tab = store.createTab(args.worktreeId, args.targetGroupId, undefined, {
    ...(split ? { split } : {}),
    ...(args.cwd ? { startupCwd: args.cwd } : {}),
    pendingStartup: {
      command: args.command,
      ...(args.env ? { env: args.env } : {}),
      ...(args.envToDelete ? { envToDelete: args.envToDelete } : {}),
      ...(args.launchConfig ? { launchConfig: args.launchConfig, launchAgent: args.agent } : {}),
      ...(args.providerSession ? { resumeProviderSession: args.providerSession } : {}),
      telemetry: {
        agent_kind: tuiAgentToAgentKind(args.agent),
        launch_source: 'sidebar',
        request_kind: 'resume'
      }
    }
  })
  store.setActiveTabType('terminal', args.worktreeId)
  rememberUserResumedTab(executionHostId, tab.id)

  persistAgentLaunchTabOrder(args.worktreeId, tab.id)

  return { tabId: tab.id }
}
