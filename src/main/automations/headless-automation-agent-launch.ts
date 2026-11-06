/* eslint-disable max-lines -- Why: Headless automation launch keeps host selection, agent startup, and terminal observation aligned in one launch path. */
import { parseWorkspaceKey } from '../../shared/workspace-scope'
import { getRepoExecutionHostId } from '../../shared/execution-host'
// Automations observe PTYs, so launch terminal agents regardless of the chat default.

import type {
  AgentLaunchPublishedSurface,
  AgentLaunchSurfaceExecution
} from '../agent-launch/agent-launch-execution'
import { executeAgentLaunch } from '../agent-launch/agent-launch-executor'
import type { RuntimeTerminalCreate } from '../../shared/runtime-terminal-create-contract'
import {
  isFinalAutomationRunStatus,
  type Automation,
  type AutomationRun
} from '../../shared/automations-types'
import { findReusableAutomationRun } from '../../shared/automation-session-reuse'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { deliverTerminalAgentLaunchPrompt } from '../runtime/rpc/methods/agent-launch-terminal-prompt'
import type { HeadlessAutomationDispatchLaunch } from './headless-dispatch'
import { buildHeadlessAutomationWorktreeCreateArgs } from './headless-workspace-create'
import type { AutomationRunTargetResult } from './run-target-resolution'
import type { Store } from '../persistence'
import {
  lowerLocalAutomationProcessPriority,
  scheduleLocalAutomationPriorityFollowups
} from './local-automation-process-priority'

const TERMINAL_ONLY_MESSAGE = 'An automation starts a terminal agent only.'

/**
 * Desktop state the launcher needs beyond the runtime: the run store for priority follow-ups and
 * the pane claims that keep one completed pane from serving two live runs.
 */
export type HeadlessAutomationAgentPorts = {
  store: Pick<Store, 'listAutomationRuns'>
  reusedPaneRuns: Map<string, string>
}

type LaunchedTerminal = {
  handle: string
  tabId?: string | null
  paneKey?: string | null
  ptyId?: string | null
}

export type HeadlessAutomationAgentLaunch = Omit<HeadlessAutomationDispatchLaunch, 'completion'> & {
  terminalHandle: string
}

export async function launchHeadlessAutomationAgent(
  runtime: OrcaRuntimeService,
  request: {
    automation: Automation
    run: Pick<AutomationRun, 'id' | 'title' | 'scheduledFor' | 'trigger'>
    target: Extract<AutomationRunTargetResult, { ok: true }>
    runs: readonly AutomationRun[]
    ports?: HeadlessAutomationAgentPorts
  }
): Promise<HeadlessAutomationAgentLaunch> {
  const { automation, run, target, ports } = request
  const agent = automation.agentId
  const selectedTarget =
    automation.workspaceMode === 'existing'
      ? await runtime.resolveManagedTerminalWorkspaceTarget(
          `id:${requireWorkspaceId(automation)}`,
          parseWorkspaceKey(automation.workspaceId ?? '')?.type === 'folder'
            ? undefined
            : getRepoExecutionHostId(target.repo),
          false
        )
      : undefined
  const selectedWorkspace = selectedTarget?.managedWorktree
  if (automation.workspaceMode === 'existing' && !selectedWorkspace) {
    throw new Error('The target workspace is no longer available.')
  }
  // The startup plan trims the prompt for every agent; a blank one launches the agent bare.
  const text = automation.prompt?.trim()
  if (automation.reuseSession && automation.workspaceMode === 'existing' && text) {
    const reused = await sendToReusableSession(
      runtime,
      { ...request, text },
      selectedWorkspace?.displayName ?? null,
      selectedWorkspace?.hostId ?? getRepoExecutionHostId(target.repo)
    )
    if (reused) {
      return settleLaunch(runtime, automation, ports, run.id, reused)
    }
  }
  let workspace: { id: string; displayName: string | null } | undefined
  let terminal: LaunchedTerminal | undefined
  const execution: AgentLaunchSurfaceExecution = {
    runtime,
    intent: {
      agent,
      // The workspace factory supplies create arguments from the automation.
      target:
        automation.workspaceMode === 'new_per_run'
          ? { kind: 'create-worktree', create: {} }
          : { kind: 'existing', worktree: requireWorkspaceId(automation) },
      ...(text ? { prompt: { text, delivery: 'submit' as const } } : {})
    },
    terminalOnly: true,
    workspaces: {
      createWorktree: async ({ startupAgent, startupPrompt }) => {
        if (startupAgent === undefined) {
          throw new Error(TERMINAL_ONLY_MESSAGE)
        }
        const { startupPrompt: _prompt, ...create } = buildHeadlessAutomationWorktreeCreateArgs({
          automation,
          run,
          repo: target.repo
        })
        let startupTerminalCreation: RuntimeTerminalCreate | undefined
        const created = await runtime.createManagedWorktree({
          onStartupTerminalCreated: (terminal) => {
            startupTerminalCreation = terminal
          },
          ...create,
          startupAgent,
          ...(startupPrompt ? { startupPrompt } : {})
        })
        workspace = {
          id: created.worktree.id,
          displayName: created.worktree.displayName ?? null
        }
        const startup = created.startupTerminal
        if (!startup?.handle) {
          throw new Error(
            created.warning || 'Automation workspace was created, but no agent terminal started.'
          )
        }
        terminal = { ...startup, handle: startup.handle }
        return {
          worktreeId: created.worktree.id,
          startupTerminalHandle: startup.handle,
          startupTerminalCreation,
          ...(startup.paneKey ? { startupTerminalPaneKey: startup.paneKey } : {}),
          // Creation stages long prompts while keeping them on the launch command.
          ...(startupPrompt ? { promptRodeLaunchCommand: true } : {})
        }
      }
    },
    surfaces: {
      createStructuredSession: () => {
        throw new Error(TERMINAL_ONLY_MESSAGE)
      },
      createTerminalAgent: async ({ worktreeId, startupPrompt }) => {
        const resolved = selectedWorkspace
        if (!resolved) {
          throw new Error('The target workspace is no longer available.')
        }
        const launched = await runtime.launchAgentTerminal(
          `id:${worktreeId}`,
          {
            agent,
            prompt: startupPrompt ?? '',
            title: run.title,
            suppressStartupUpdatePrompt: true,
            ...(automation.extraAgentArgs ? { extraAgentArgs: automation.extraAgentArgs } : {}),
            // Run now is the user's act and may start a stopped WSL distro; a scheduled run never does.
            ...(run.trigger === 'scheduled' ? {} : { wslUserAct: true as const })
          },
          {
            worktree: resolved,
            repo: target.repo,
            folderWorkspace: selectedTarget?.scope.folderWorkspace ?? undefined
          }
        )
        terminal = launched
        workspace = { id: launched.worktreeId, displayName: resolved.displayName ?? null }
        return {
          handle: launched.handle,
          terminalCreation: launched,
          ...(launched.paneKey ? { paneKey: launched.paneKey } : {}),
          ...(startupPrompt ? { promptRodeLaunchCommand: true } : {})
        }
      },
      deliverTerminalPrompt: ({ handle, prompt, terminalCreation }) =>
        runtime.deliverStartupFollowup(handle, { agent, prompt: prompt.text }, { terminalCreation })
    }
  }
  await launchUntilPublished(execution)
  if (!workspace || !terminal) {
    throw new Error('Automation agent launch did not report its terminal.')
  }
  return settleLaunch(runtime, automation, ports, run.id, {
    workspaceId: workspace.id,
    workspaceDisplayName: workspace.displayName,
    terminalHandle: terminal.handle,
    terminalSessionId: terminal.tabId ?? null,
    terminalPaneKey: terminal.paneKey ?? null,
    terminalPtyId: terminal.ptyId ?? null
  })
}

/**
 * Lower the new agent's process priority and keep it lowered while the run owns its PTY.
 * Desktop-only follow-ups stop once the run is final or its PTY has been replaced.
 */
async function settleLaunch(
  runtime: OrcaRuntimeService,
  automation: Automation,
  ports: HeadlessAutomationAgentPorts | undefined,
  runId: string,
  launch: HeadlessAutomationAgentLaunch
): Promise<HeadlessAutomationAgentLaunch> {
  const ptyId = launch.terminalPtyId ?? null
  await lowerLocalAutomationProcessPriority(ptyId)
  if (ports && automation.executionTargetType === 'local' && ptyId) {
    scheduleLocalAutomationPriorityFollowups(
      ptyId,
      () =>
        runtime.getTerminalPtyIdForHandle(launch.terminalHandle) === ptyId &&
        ports.store
          .listAutomationRuns(automation.id)
          .some(
            (candidate) => candidate.id === runId && !isFinalAutomationRunStatus(candidate.status)
          )
    )
  }
  return launch
}

async function sendToReusableSession(
  runtime: OrcaRuntimeService,
  request: {
    automation: Automation
    run: Pick<AutomationRun, 'id'>
    runs: readonly AutomationRun[]
    text: string
    target: Extract<AutomationRunTargetResult, { ok: true }>
    ports?: HeadlessAutomationAgentPorts
  },
  workspaceDisplayName: string | null,
  physicalHostId: string
): Promise<HeadlessAutomationAgentLaunch | null> {
  const { automation, text, ports } = request
  const worktreeId = requireWorkspaceId(automation)
  const session = findReusableAutomationRun({
    automationId: automation.id,
    agentId: automation.agentId,
    worktreeId,
    target: {
      hostId: getRepoExecutionHostId(request.target.repo),
      repoId: request.target.repo.id,
      path: request.target.repo.path
    },
    currentRunId: request.run.id,
    runs: request.runs,
    agentStatusForPane: (paneKey) =>
      runtime
        .getAgentStatusRowsForPane(paneKey)
        .filter((row) => !row.providerSessionOnly)
        .toSorted((left, right) => right.receivedAt - left.receivedAt)[0],
    liveSession: (previous) => {
      const handle = runOwnHandle(runtime, previous)
      const liveWorktreeId = handle ? runtime.getTerminalWorktreeIdForHandle(handle) : null
      const liveHostId = handle
        ? runtime.getPtyExecutionHostMetadata(runtime.getTerminalPtyIdForHandle(handle))
            .executionHostId
        : undefined
      if (!handle || liveWorktreeId !== worktreeId || liveHostId !== physicalHostId) {
        return null
      }
      // Only an untouched PTY whose pane no other live run holds may be reused.
      if (!isPaneFreeForReuse(ports, request.runs, previous, previous.terminalPaneKey)) {
        return null
      }
      return runtime.readTerminalClientUse(previous.terminalPtyId) === 'unused'
        ? { handle, previous }
        : null
    }
  })
  if (!session) {
    return null
  }
  const paneKey = session.previous.terminalPaneKey
  ports?.reusedPaneRuns.set(paneKey, request.run.id)
  let delivered = false
  try {
    delivered = await deliverTerminalAgentLaunchPrompt({
      runtime,
      handle: session.handle,
      agent: automation.agentId,
      freshLaunch: false,
      text,
      // Windows cannot prove which agent is foreground; refuse only a proven shell.
      unprovableHost: 'write-unless-shell'
    })
  } finally {
    if (!delivered) {
      ports?.reusedPaneRuns.delete(paneKey)
    }
  }
  if (!delivered) {
    return null
  }
  return {
    workspaceId: worktreeId,
    workspaceDisplayName,
    terminalHandle: session.handle,
    terminalSessionId: session.previous.terminalSessionId,
    terminalPaneKey: session.previous.terminalPaneKey,
    terminalPtyId: session.previous.terminalPtyId
  }
}

/**
 * A pane is free only if no earlier reuse claimed it for a run that is still active, and no
 * other unfinished run of this automation owns its pane key. Stale claims are dropped here.
 */
function isPaneFreeForReuse(
  ports: HeadlessAutomationAgentPorts | undefined,
  runs: readonly AutomationRun[],
  previous: { id: string; terminalPaneKey: string },
  paneKey: string
): boolean {
  if (ports) {
    const claimedBy = ports.reusedPaneRuns.get(paneKey)
    if (claimedBy) {
      const claimant = runs.find((run) => run.id === claimedBy)
      if (claimant && !isFinalAutomationRunStatus(claimant.status)) {
        return false
      }
      ports.reusedPaneRuns.delete(paneKey)
    }
  }
  return !runs.some(
    (run) =>
      run.id !== previous.id &&
      run.terminalPaneKey === paneKey &&
      !isFinalAutomationRunStatus(run.status)
  )
}

/** Reject reused pane handles whose PTY no longer belongs to this run. */
export function runOwnHandle(
  runtime: Pick<OrcaRuntimeService, 'getTerminalHandleForPaneKey' | 'getTerminalPtyIdForHandle'>,
  run: AutomationRun
): string | null {
  const handle = run.terminalPaneKey
    ? runtime.getTerminalHandleForPaneKey(run.terminalPaneKey)
    : null
  return handle &&
    run.terminalPtyId &&
    runtime.getTerminalPtyIdForHandle(handle) === run.terminalPtyId
    ? handle
    : null
}

/** Return on terminal publication; post-start prompt delivery may still be pending. */
function launchUntilPublished(
  execution: AgentLaunchSurfaceExecution
): Promise<AgentLaunchPublishedSurface> {
  return new Promise((resolve, reject) => {
    let published = false
    executeAgentLaunch({
      ...execution,
      onSurfacePublished: (surface) => {
        published = true
        resolve(surface)
      }
    }).catch((error: unknown) => {
      if (!published) {
        reject(error)
        return
      }
      console.warn('[automations] the agent launch failed after its terminal was published', error)
    })
  })
}

function requireWorkspaceId(automation: Automation): string {
  if (!automation.workspaceId) {
    throw new Error('The target workspace is no longer available.')
  }
  return automation.workspaceId
}
