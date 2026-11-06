import {
  launchNewTabPromptThroughHost,
  newTabPromptLaunchesThroughHost
} from '@/lib/launch-agent-new-tab-host-route'
import type { LaunchAgentInNewTabArgs } from '@/lib/launch-agent-in-new-tab-args'
import { useAppStore } from '@/store'
import { validateActionTerminalArgs } from './launch-work-item-direct-messages'
import { planLaunchAgentStartupPrompt } from '@/lib/launch-agent-startup-prompt-plan'
import { persistAgentLaunchTabOrder } from '@/lib/launch-agent-tab-order'
import { tuiAgentToAgentKind } from '@/lib/telemetry'
import { seedNativeChatLaunchDraftForAgentTab } from '@/lib/agent-launch-prompt-delivery'
import { pasteAgentLaunchPromptOnceReady } from '@/lib/launch-agent-tab-prompt-paste'
import { runtimeEnvironmentIdOrLocalUnlessTwin } from '@/lib/worktree-runtime-owner'
import { resolveWorktreeOperationRouteForHost } from '@/lib/worktree-operation-route'
import { isWebRuntimeSessionActive } from '@/runtime/web-runtime-session-environment'
import { launchAgentInWebHostTab } from '@/lib/launch-agent-web-host-tab'
import { resolveAgentStartupPlanInputs } from '../../../shared/agent-startup-plan-inputs'
import { readAgentLaunchPreferencesForWorktree } from '@/components/settings/use-host-agent-launch-preferences'
import { TUI_AGENT_CONFIG } from '../../../shared/tui-agent-config'
import { resolveAgentLaunchExecutionContext } from '@/lib/launch-agent-execution-context'
import { launchStructuredAgentFromNewTab } from '@/lib/launch-agent-in-new-tab-structured-route'
import { workspaceKindForWorktreeId } from '@/lib/agent-launch-route-input'
import {
  launchOnceHostAnswered,
  routeNewTabLaunch,
  type AgentTabLaunchOutcome,
  type LaunchAgentInNewTabResult
} from '@/lib/launch-agent-in-new-tab-host-agents'

export type { LaunchAgentInNewTabArgs } from '@/lib/launch-agent-in-new-tab-args'
export type { AgentLaunchSurface } from '@/lib/launch-agent-in-new-tab-host-agents'

export { shouldQueueTerminalFocusAfterMenuClose } from '@/lib/launch-agent-in-new-tab-host-agents'

/**
 * Create a new terminal tab and queue the agent's launch command, optionally
 * with an initial prompt.
 *
 * Submission mode follows `promptInjectionMode`: argv/flag agents fold the
 * prompt into the launch command; followup-path agents launch empty and get a
 * post-ready draft paste. Callers can override via `promptDelivery`.
 *
 * Returns `null` when no startup plan can be built (e.g. a whitespace-only prompt),
 * or when the launch was refused before a surface opened.
 */
export function launchAgentInNewTabWithOutcome(
  args: LaunchAgentInNewTabArgs,
  notifyFailure = true
): AgentTabLaunchOutcome {
  const {
    agent,
    worktreeId,
    executionHostId,
    groupId,
    prompt,
    agentArgs,
    sessionOptions,
    initialCwd,
    promptDelivery = 'auto-submit',
    launchSource,
    quickCommandLabel,
    launchPlatform,
    onPromptDelivered,
    onPromptDeliveryUnconfirmed,
    pendingActivationSpawn,
    beforeSurfaceOpen,
    activate
  } = args
  const store = useAppStore.getState()
  const executionContext = resolveAgentLaunchExecutionContext(store, {
    worktreeId,
    ...(executionHostId ? { executionHostId } : {}),
    ...(launchPlatform ? { launchPlatform } : {})
  })
  // Why: a null context means the host's OS is unknown and the user was already told; the launch is refused.
  if (!executionContext) {
    args.focusIntent?.cancel()
    return null
  }
  const { resolvedLaunchPlatform, isRemote, queuedShell } = executionContext
  const trimmedPrompt = prompt?.trim() ?? ''
  const hasPrompt = trimmedPrompt.length > 0
  const isFollowupPath = TUI_AGENT_CONFIG[agent].promptInjectionMode === 'stdin-after-start'
  // Why: a followup-path agent gets its prompt pasted unsubmitted after start, so route it as a draft.
  const routePromptDelivery =
    hasPrompt && isFollowupPath && promptDelivery === 'auto-submit' ? 'draft' : promptDelivery
  // Resolve structured ownership first; only terminal routes plan CLI arguments.
  const route = routeNewTabLaunch(store, args, {
    agent,
    requestedSurface: args.requestedSurface,
    selectedExecutionHostId: args.selectedExecutionHostId,
    workspace: {
      kind: workspaceKindForWorktreeId(worktreeId),
      worktreeId,
      ...(executionHostId ? { executionHostId } : {})
    },
    prompt: trimmedPrompt,
    promptDelivery: routePromptDelivery,
    tuiCustomization: { cwd: initialCwd },
    ...(sessionOptions ? { launchOptions: sessionOptions } : {}),
    onPromptDelivered,
    ...(args.promptKeptByCaller ? { promptKeptByCaller: true as const } : {})
  })
  if ('awaited' in route) {
    return launchOnceHostAnswered(route, args, (next) => launchAgentInNewTabWithOutcome(next))
  }
  const { plan } = route
  if (plan?.route === 'structured-native-chat') {
    const structured = launchStructuredAgentFromNewTab({
      plan,
      worktreeId,
      ...(activate === false ? { activate: false } : {}),
      ...(args.focusIntent ? { focusIntent: args.focusIntent } : {}),
      ...(groupId ? { groupId } : {}),
      ...(beforeSurfaceOpen ? { beforeSurfaceOpen } : {}),
      ...(args.onStructuredHostDeclined ? { onHostDeclined: args.onStructuredHostDeclined } : {}),
      // The host's "no" opens this same launch as a terminal, with the caller's arguments.
      openTerminal: (terminalPlan, terminalActivate) =>
        launchAgentInNewTabWithOutcome({
          ...args,
          beforeSurfaceOpen: undefined,
          ...(terminalActivate === false ? { prompt: undefined, activate: false } : {}),
          requestId: undefined,
          agentSessionLaunchPlan: terminalPlan
        })
    })
    if (!structured) {
      args.focusIntent?.cancel()
      return null
    }
    return structured
  }

  const terminalShell = queuedShell ?? (resolvedLaunchPlatform === 'win32' ? 'powershell' : 'posix')
  if (!validateActionTerminalArgs(agent, agentArgs, terminalShell, notifyFailure)) {
    args.focusIntent?.cancel()
    return { refused: { delivered: false, failureNotified: notifyFailure } }
  }
  const buildStartup = (
    agentLaunchChoices = readAgentLaunchPreferencesForWorktree(store, worktreeId).agentLaunchChoices
  ) =>
    planLaunchAgentStartupPrompt({
      base: resolveAgentStartupPlanInputs({
        agent,
        settings: { ...store.settings, agentLaunchChoices },
        agentArgs,
        sessionOptions,
        sessionOptionsYieldToAgentArgs: args.sessionOptionsYieldToAgentArgs,
        platform: resolvedLaunchPlatform,
        shell: queuedShell,
        isRemote
      }),
      prompt: trimmedPrompt,
      promptDelivery,
      isFollowupPath
    })
  args.focusIntent?.cancel()
  // Why: a host-qualified launch reads the runtime of that host, since the same worktree id can exist on several hosts.
  const runtimeEnvironmentId = executionHostId
    ? (resolveWorktreeOperationRouteForHost(store, worktreeId, executionHostId)
        ?.runtimeEnvironmentId ?? null)
    : runtimeEnvironmentIdOrLocalUnlessTwin(store, worktreeId)
  if (isWebRuntimeSessionActive(runtimeEnvironmentId)) {
    if (beforeSurfaceOpen?.({ kind: 'host-published' }) === false) {
      return null
    }
    const webHostDelivery = launchAgentInWebHostTab({
      agent,
      worktreeId,
      environmentId: runtimeEnvironmentId,
      groupId,
      cwd: initialCwd,
      buildStartup,
      sessionOptions,
      prompt: trimmedPrompt,
      promptDelivery,
      agentArgs,
      viewMode: 'terminal',
      ...(activate === false ? { activate: false } : {}),
      onPromptDelivered
    })
    return {
      surface: { kind: 'host-published' },
      terminalCompletion: webHostDelivery,
      pasteDraftAfterLaunch: false,
      ...(hasPrompt ? { promptDeliveryResult: webHostDelivery } : {})
    }
  }

  const { startupPlan, pasteDraftAfterLaunch, submitPastedPrompt } = buildStartup()
  let promptDeliveryResult: Promise<{ delivered: boolean; failureNotified: boolean }> | undefined
  if (!startupPlan) {
    return null
  }

  if (beforeSurfaceOpen?.({ kind: 'local-terminal' }) === false) {
    return null
  }
  if (
    pasteDraftAfterLaunch !== null &&
    newTabPromptLaunchesThroughHost({ promptDelivery, pastesPrompt: true, isRemote })
  ) {
    const launched = launchNewTabPromptThroughHost({
      agent,
      worktreeId,
      ...(groupId ? { groupId } : {}),
      prompt: trimmedPrompt,
      ...(agentArgs !== undefined ? { agentArgs } : {}),
      ...(sessionOptions ? { sessionOptions } : {}),
      ...(initialCwd?.trim() ? { cwd: initialCwd } : {}),
      launchSource: launchSource ?? 'tab_bar_quick_launch',
      quickCommandLabel,
      ...(activate === false ? { activate: false } : {}),
      ...(pendingActivationSpawn ? { pendingActivationSpawn: true } : {}),
      pasteContent: pasteDraftAfterLaunch,
      submit: submitPastedPrompt,
      ...(onPromptDelivered ? { onPromptDelivered } : {}),
      ...(onPromptDeliveryUnconfirmed ? { onPromptDeliveryUnconfirmed } : {})
    })
    return {
      surface: { kind: 'local-terminal', tabId: launched.tabId },
      startupPlan,
      pasteDraftAfterLaunch: true,
      promptDeliveryResult: launched.promptDeliveryResult
    }
  }
  // Publish the tab and its startup recipe atomically so no subscriber can mount a bare shell
  // between separate create and queue state updates.
  const tab = store.createTab(worktreeId, groupId, undefined, {
    launchAgent: agent,
    ...(executionHostId ? { executionHostId } : {}),
    quickCommandLabel,
    ...(pendingActivationSpawn ? { pendingActivationSpawn: true } : {}),
    ...(activate === false ? { activate: false } : {}),
    pendingStartup: {
      command: startupPlan.launchCommand,
      ...(startupPlan.env ? { env: startupPlan.env } : {}),
      launchConfig: startupPlan.launchConfig,
      launchAgent: agent,
      ...(agentArgs !== undefined ? { agentArgsOverride: agentArgs } : {}),
      ...(startupPlan.startupCommandDelivery
        ? { startupCommandDelivery: startupPlan.startupCommandDelivery }
        : {}),
      ...(agent === 'command-code' && hasPrompt && promptDelivery === 'auto-submit'
        ? { initialAgentStatus: { agent, prompt: trimmedPrompt } }
        : {}),
      telemetry: {
        agent_kind: tuiAgentToAgentKind(agent),
        launch_source: launchSource ?? 'tab_bar_quick_launch',
        request_kind: 'new'
      }
    }
  })
  if (initialCwd?.trim()) {
    // Why: queue before mount so local, WSL, and SSH continuations preserve their subdirectory.
    store.queueTabInitialCwd(tab.id, initialCwd)
  }
  // Why: fire-and-forget the paste-after-ready delivery so callers keep the synchronous { tabId, startupPlan } signature.
  // Why: safe to call unconditionally — the helper short-circuits (no paste) for native-prefill agents already holding the draft.
  if (hasPrompt && promptDelivery === 'draft' && pasteDraftAfterLaunch === null) {
    // Why: the draft rode in on argv (Claude --prefill etc.), so no paste runs
    // and deliverLaunchPromptToAgentTab never seeds. Mirror it into chat here.
    seedNativeChatLaunchDraftForAgentTab({ tabId: tab.id, agent, text: trimmedPrompt })
  }
  if (pasteDraftAfterLaunch !== null) {
    const deliveryPromise = pasteAgentLaunchPromptOnceReady({
      worktreeId,
      tabId: tab.id,
      agent,
      content: pasteDraftAfterLaunch,
      submit: submitPastedPrompt,
      prompt: trimmedPrompt,
      ...(onPromptDelivered ? { onPromptDelivered } : {}),
      ...(onPromptDeliveryUnconfirmed ? { onPromptDeliveryUnconfirmed } : {})
    })
    if (promptDelivery === 'submit-after-ready') {
      promptDeliveryResult = deliveryPromise
    } else {
      void deliveryPromise.catch((error) =>
        console.error('Prompt delivery failed after launch', error)
      )
    }
  } else if (hasPrompt) {
    onPromptDelivered?.()
  }

  // Why: without setActiveTabType('terminal') an activated launch can stay hidden behind an editor.
  // Scoped to the launch's worktree; a floating or background launch leaves the main window's tab alone.
  if (activate !== false) {
    store.setActiveTabType('terminal', worktreeId)
  }

  // Why: persist tab-bar order so reconcileTabOrder doesn't fall back to terminals-first and jump the new tab to index 0.
  persistAgentLaunchTabOrder(worktreeId, tab.id)

  return {
    surface: { kind: 'local-terminal', tabId: tab.id },
    startupPlan,
    pasteDraftAfterLaunch: pasteDraftAfterLaunch !== null,
    ...(promptDeliveryResult ? { promptDeliveryResult } : {})
  }
}

/** Returns `null` when the launch was refused; callers treat that as "nothing opened". */
export function launchAgentInNewTab(args: LaunchAgentInNewTabArgs): LaunchAgentInNewTabResult {
  const result = launchAgentInNewTabWithOutcome(args, false)
  return result && 'refused' in result ? null : result
}
