import type { AgentLaunchChoices } from '../../../shared/agent-launch-choices'
import { structuredAgentLabel } from './agent-session/launch/structured-agent-session-launch-label'
import type { SessionOptionValue } from '../../../shared/native-chat/input/native-chat-session-options'
import { ensureAgentLaunchPreferences } from '@/components/settings/use-host-agent-launch-preferences'
import { hostSupportsLaunchChoices } from '@/components/settings/agent-launch-settings-transport'
import { createWebRuntimeSessionTerminalResult } from '@/runtime/web-runtime-terminal-create-operation'
import { webTerminalPlacementParentTabId } from '@/runtime/web-session-terminal-placement'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import {
  createWebRuntimeAgentSessionTerminal,
  createWebRuntimeAgentSessionTerminalWithLaunchDraft,
  type createWebRuntimeSessionTerminal
} from '@/runtime/web-runtime-terminal-creation'
import type { LaunchAgentStartupPromptPlan } from '@/lib/launch-agent-startup-prompt-plan'
import type { Tab } from '../../../shared/tab-types'
import type { TuiAgent } from '../../../shared/tui-agent'
import type { AgentPromptDelivery } from '../../../shared/agent-session/agent-session-host-authority'
import { translate } from '@/i18n/i18n'
import {
  agentLaunchNeedsPreparedCommand,
  toAgentLaunchPreferences
} from '../../../shared/agent-launch-preferences'
import { resolveTerminalHostOwnership } from './terminal-worktree-route'
import {
  isWebTerminalSurfaceTabId,
  toWebTerminalSurfaceTabId
} from '../../../shared/terminal-surface-id'
import type { AgentTerminalLaunchCompletion } from './agent-session/launch/structured-agent-session-launch-admission'

function removeStaleLocalAgentTabsForWebHostLaunch(
  worktreeId: string,
  environmentId: string | null
): void {
  const state = useAppStore.getState()
  const tabHosts = new Map(
    (state.unifiedTabsByWorktree?.[worktreeId] ?? [])
      .filter((tab) => tab.contentType === 'terminal')
      .map((tab) => [tab.entityId, tab.executionHostId])
  )
  for (const tab of state.tabsByWorktree[worktreeId] ?? []) {
    if (!tab.launchAgent || isWebTerminalSurfaceTabId(tab.id)) {
      continue
    }
    // A retained PTY binding is not evidence of a stale row, even if contact was lost.
    if (
      tab.ptyId ||
      state.ptyIdsByTabId[tab.id]?.length ||
      Object.values(state.terminalLayoutsByTabId[tab.id]?.ptyIdsByLeafId ?? {}).some(Boolean)
    ) {
      continue
    }
    const owner = resolveTerminalHostOwnership(state, worktreeId, 'teardown', tabHosts.get(tab.id))
    if (owner.kind === 'runtime' && owner.runtimeEnvironmentId === environmentId) {
      // Why: pruning a stale local agent tab is a system close — keep it out of
      // the Cmd+Shift+T reopen stack.
      state.closeTab(tab.id, { reason: 'cleanup' })
    }
  }
}

/**
 * Launch an agent terminal on the web runtime host instead of a local tab.
 *
 * Why: paired web tabs are host-owned, so this path never creates a local tab
 * (callers return tabId: null). Local-only agent tabs cannot be closed because
 * close routes through session.tabs.close on the host, so prune them before
 * the host snapshot.
 */
export async function launchAgentInWebHostTab(args: {
  agent: TuiAgent
  worktreeId: string
  environmentId: string | null
  groupId?: string
  cwd?: string | null
  buildStartup: (choices: AgentLaunchChoices | undefined) => LaunchAgentStartupPromptPlan
  sessionOptions?: Readonly<Record<string, SessionOptionValue>>
  prompt: string
  promptDelivery: 'auto-submit' | 'draft' | 'submit-after-ready'
  agentArgs?: string | null
  viewMode?: Tab['viewMode']
  /** Whether the host-created tab takes the foreground; false for a background launch. */
  activate?: boolean
  onPromptDelivered?: () => void
}): Promise<{ delivered: boolean; failureNotified: boolean } & AgentTerminalLaunchCompletion> {
  const {
    agent,
    worktreeId,
    environmentId,
    groupId,
    cwd,
    prompt,
    promptDelivery,
    agentArgs,
    viewMode,
    activate = true,
    onPromptDelivered
  } = args
  const failureMessage = translate(
    'agentLaunch.terminalPreparationFailed',
    "Couldn't open a terminal for {{value0}}. Check the workspace connection and agent settings, then try again.",
    { value0: structuredAgentLabel(agent) }
  )
  let capable: boolean
  let startup: LaunchAgentStartupPromptPlan
  try {
    capable = environmentId ? await hostSupportsLaunchChoices({ environmentId }) : false
    const preferences = await ensureAgentLaunchPreferences(useAppStore.getState(), {
      kind: 'git-worktree',
      worktreeId
    })
    startup = args.buildStartup(
      preferences.agentLaunchChoices ??
        (capable ? {} : useAppStore.getState().settings?.agentLaunchChoices)
    )
  } catch (error) {
    const cancelled = error instanceof Error && error.name === 'AbortError'
    if (!cancelled) {
      toast.error(failureMessage)
    }
    return {
      delivered: false,
      failureNotified: true,
      outcome: { status: 'failed', message: cancelled ? '' : failureMessage }
    }
  }
  const { startupPlan, pasteDraftAfterLaunch: pastePromptAfterReady, submitPastedPrompt } = startup
  if (!startupPlan) {
    toast.error(failureMessage)
    return {
      delivered: false,
      failureNotified: true,
      outcome: { status: 'failed', message: failureMessage }
    }
  }
  const hasPrompt = prompt.length > 0
  const launchPreferences = toAgentLaunchPreferences(
    capable ? args.sessionOptions : startupPlan.sessionOptions,
    agent
  )
  const structuredPromptDelivery: AgentPromptDelivery =
    promptDelivery === 'draft' ? 'draft' : 'auto-submit'
  const pruneLegacyTabs = (): void => {
    removeStaleLocalAgentTabsForWebHostLaunch(worktreeId, environmentId)
  }
  pruneLegacyTabs()
  const launch = {
    worktreeId,
    environmentId,
    targetGroupId: groupId,
    activate,
    ...(activate ? {} : { selectWorktree: false }),
    ...(cwd?.trim() ? { cwd } : {}),
    ...(viewMode ? { viewMode } : {}),
    agentSessionKind: 'fresh',
    // Prepared delivery retains caller settings; authoritative creation resolves the host defaults.
    launchAgent: agent,
    preparedAgentCommand: agentLaunchNeedsPreparedCommand(agent, startupPlan.sessionOptions),
    command: startupPlan.launchCommand,
    ...(startupPlan.env ? { env: startupPlan.env } : {}),
    launchConfig: startupPlan.launchConfig,
    ...(startupPlan.startupCommandDelivery
      ? { startupCommandDelivery: startupPlan.startupCommandDelivery }
      : {}),
    ...(hasPrompt && pastePromptAfterReady === null ? { prompt } : {}),
    ...(hasPrompt && pastePromptAfterReady === null
      ? { promptDelivery: structuredPromptDelivery }
      : {}),
    ...(!capable && launchPreferences?.mode
      ? { agentArgs: startupPlan.launchConfig.agentArgs }
      : agentArgs !== undefined
        ? { agentArgs }
        : {}),
    ...(launchPreferences ? { launchPreferences } : {})
  } as const

  const handleCreation = ({
    outcome,
    promptDelivered,
    hostTabId
  }: {
    outcome: Awaited<ReturnType<typeof createWebRuntimeSessionTerminal>>
    promptDelivered: boolean
    hostTabId?: string
  }): { delivered: boolean; failureNotified: boolean } & AgentTerminalLaunchCompletion => {
    // Why: created means the host accepted the launch, not that a local tab
    // exists; keep pruning stale local rows until the snapshot mirrors.
    pruneLegacyTabs()
    if (outcome.status === 'failed') {
      toast.error(failureMessage)
      return { delivered: false, failureNotified: true, outcome }
    }
    if (args.activate !== false) {
      useAppStore.getState().setActiveTabType('terminal', worktreeId)
    }
    if (hasPrompt && promptDelivered) {
      onPromptDelivered?.()
    }
    const failureNotified = hasPrompt && !promptDelivered
    if (failureNotified) {
      toast.error(
        translate(
          'agentLaunch.terminalPromptFailed',
          'Orca opened a terminal for {{value0}}, but could not pass it your prompt. Send the prompt in that terminal.',
          { value0: structuredAgentLabel(agent) }
        )
      )
    }
    return {
      delivered: promptDelivered,
      failureNotified,
      outcome,
      ...(hostTabId
        ? { tabId: toWebTerminalSurfaceTabId(webTerminalPlacementParentTabId(hostTabId)) }
        : {})
    }
  }

  if (pastePromptAfterReady !== null) {
    return createWebRuntimeAgentSessionTerminal({
      ...launch,
      agent,
      promptAfterReady: pastePromptAfterReady,
      submitPrompt: submitPastedPrompt,
      forcePromptPaste: true
    }).then(handleCreation)
  }
  if (hasPrompt && promptDelivery === 'draft') {
    // Native launch-command prefill skips paste, so explicitly seed this host class’s chat composer.
    return createWebRuntimeAgentSessionTerminalWithLaunchDraft({
      ...launch,
      agent,
      launchDraft: prompt
    }).then(handleCreation)
  }
  return createWebRuntimeSessionTerminalResult(launch).then((created) =>
    handleCreation({
      ...created,
      promptDelivered: created.outcome.status === 'created' && hasPrompt
    })
  )
}
