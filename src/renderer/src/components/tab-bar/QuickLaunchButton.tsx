/* eslint-disable max-lines -- Why: Quick launch owns picker state, draft selection, and launch submission for the tab bar entry point. */
import { SubscribedAgentLaunchPickerMenu } from '@/components/agent/AgentLaunchPickerMenu'
import {
  agentPickerLaunchInputs,
  type AgentPickerEntry,
  type AgentPickerDraft
} from '../../../../shared/agent-launch-picker'
import React, { useCallback, useRef, useSyncExternalStore } from 'react'
import { Loader2, Settings as SettingsIcon } from 'lucide-react'
import { toast } from 'sonner'
import { launchAgentInNewTab } from '@/lib/launch-agent-in-new-tab'
import type { LaunchAgentInNewTabArgs } from '@/lib/launch-agent-in-new-tab-args'
import { newAgentLaunchRequestId } from '@/lib/agent-launch-request-id'
import { captureNativeChatComposerFocusIntent } from '@/components/native-chat/use-native-chat-composer-reveal-focus'
import { newAgentPromptOutcome } from '@/lib/new-agent-prompt-outcome'
import { activeAgentNotesSendFailureMessage } from '@/lib/active-agent-note-send-result'
import { AgentSurfaceLaunchButton } from '@/components/agent/AgentSurfaceLaunchButton'
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut
} from '@/components/ui/dropdown-menu'
import { getAgentCatalog, AgentIcon } from '@/lib/agent-catalog'
import { useAppStore } from '@/store'
import { useOptionalShortcutLabel } from '@/hooks/useShortcutLabel'
import { useDetectedAgents } from '@/hooks/useDetectedAgents'
import { useAgentMenuShortcutLabels } from './agent-menu-shortcut-labels'
import type { AgentPickerInventorySource } from '../agent/use-agent-launch-picker-inventory'
import { isAgentSessionHandleProvider } from '../../../../shared/agent-session/lifecycle/agent-session-provider-handle'
import type { ExecutionHostId } from '../../../../shared/execution-host'
import type { TuiAgent } from '../../../../shared/tui-agent'
import type { LaunchSource } from '../../../../shared/telemetry-events'
import type { TopLevelView } from '../../../../shared/ui-chrome-types'
import {
  DEFAULT_DISABLED_TUI_AGENTS,
  filterEnabledTuiAgents
} from '../../../../shared/tui-agent-selection'
import { translate } from '@/i18n/i18n'
import { useUiLanguageRevision } from '@/i18n/use-ui-language-revision'
import { cn } from '@/lib/utils'
import type { NewTabAgentMenuRow } from '@/lib/new-tab-agent-menu-rows'
import { useNewTabAgentMenuRows, type NewTabAgentMenuModel } from './use-new-tab-agent-menu-rows'
import { useAgentDetectionTargetForWorktree } from '@/hooks/useAgentDetectionTarget'
import { chatUnavailableLabel, rowTitle, rowLabel, rowId } from './tab-agent-row-presentation'
import {
  getStructuredAgentLaunchStatus
} from '@/lib/agent-session/launch/structured-agent-session-launch-status'
import { subscribeStructuredAgentLaunchStatus } from '@/lib/agent-session/launch/structured-agent-session-launch-registry'

export type QuickLaunchAgentMenuItemsProps = {
  worktreeId: string
  /** The host the user picked, from a surface that lists one row per host. A `worktreeId`
   *  names no host, so two publications of it are indistinguishable without this. */
  executionHostId?: ExecutionHostId
  /** Tab group the user launched from; keeps split-group launches in that pane instead of the active group. */
  groupId?: string
  /** Called with the new tab id once it exists. The tab bar focuses it, the
   *  session grid mounts it in the background; this component owns neither. */
  onLaunched?: (tabId: string) => void
  /** Reuse the tab bar’s focus handoff after creating a terminal tab. */
  onFocusTerminal?: (tabId: string) => void
  /** The launch surface owns navigation to the created native chat. */
  onStructuredLaunched?: (sessionId: string) => void
  /** Host publication has no local tab ID; the picker can close after dispatch. */
  onHostPublished?: () => void
  /** Forward the initial prompt; delivery policy determines submission versus a user-confirmed draft. */
  prompt?: string
  /** Use non-default modes for generated context that must not become shell syntax. */
  promptDelivery?: 'auto-submit' | 'draft' | 'submit-after-ready'
  /** Default launch telemetry to tab_bar_quick_launch. */
  launchSource?: LaunchSource
  /** Called after a prompt is queued into the agent, or immediately for argv prompt launches. */
  onPromptDelivered?: () => void
  /** Given the launch's own delivery result while the prompt is still on its way. */
  onPromptHandedOff?: (delivered: Promise<unknown>) => void
  /** Nothing to send: e.g. every note is already on its way, so no agent is started. */
  disabled?: boolean
  /** Whether the launched tab takes the foreground. Default true, which is what the tab bar's
   *  `+` wants; a surface launching into a workspace it is not standing in passes false. */
  activate?: boolean
}

const ROW_NAVIGATION_KEYS = new Set(['ArrowLeft', 'ArrowUp', 'ArrowDown', 'Home', 'End'])

const PLACEHOLDER_WIDTHS = ['w-3/5', 'w-1/2', 'w-2/3', 'w-2/5', 'w-3/4', 'w-1/3', 'w-4/5', 'w-1/4']

function getCatalogEntry(agent: TuiAgent): { id: TuiAgent; label: string } | null {
  return getAgentCatalog().find((a) => a.id === agent) ?? null
}

function orderAgents(
  defaultAgent: TuiAgent | 'blank' | null | undefined,
  detected: TuiAgent[]
): TuiAgent[] {
  const inCatalogOrder = getAgentCatalog()
    .filter((entry) => detected.includes(entry.id))
    .map((entry) => entry.id)
  if (!defaultAgent || defaultAgent === 'blank' || !inCatalogOrder.includes(defaultAgent)) {
    return inCatalogOrder
  }
  // Why: surface the user's configured default first, matching the split-button behavior.
  return [defaultAgent, ...inCatalogOrder.filter((id) => id !== defaultAgent)]
}

/** The toast only fires on a surface where the user can see the failed launch. */
export function shouldShowLaunchWatchdogTimeout({
  hasPty,
  isWorktreeActive,
  activeView
}: {
  hasPty: boolean
  isWorktreeActive: boolean
  activeView: TopLevelView
}): boolean {
  if (hasPty) {
    return false
  }
  // Why the sessions view too: the grid launches into workspaces that are not
  // the active one, so its card would fail silently while the user watches it.
  return isWorktreeActive || activeView === 'sessions'
}

function getLaunchWatchdogTimeoutMessage(label: string): string {
  return `Couldn't launch ${label}: the terminal did not start.`
}

function getTerminalLaunchState(tabId: string): { stillOpen: boolean; hasPty: boolean } {
  const state = useAppStore.getState()
  const hasPtyBinding = (state.ptyIdsByTabId[tabId]?.length ?? 0) > 0
  let stillOpen = false
  let tabPtyId: string | null = null

  for (const tabs of Object.values(state.tabsByWorktree)) {
    const tab = tabs.find((t) => t.id === tabId)
    if (tab) {
      stillOpen = true
      tabPtyId = tab.ptyId
      break
    }
  }

  return { stillOpen, hasPty: hasPtyBinding || tabPtyId !== null }
}

async function waitForTerminalPty(tabId: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const launchState = getTerminalLaunchState(tabId)
    if (launchState.hasPty) {
      return true
    }
    await new Promise((resolve) => window.setTimeout(resolve, 100))
  }
  return getTerminalLaunchState(tabId).hasPty
}

/** Everything one menu launch needs from the surface that rendered it. */
type MenuLaunchContext = {
  worktreeId: string
  executionHostId?: ExecutionHostId
  groupId?: string
  prompt?: string
  promptDelivery?: QuickLaunchAgentMenuItemsProps['promptDelivery']
  launchSource?: LaunchSource
  activate?: boolean
  onPromptDelivered?: () => void
  onPromptHandedOff?: (delivered: Promise<unknown>) => void
  onLaunched?: (tabId: string) => void
  onFocusTerminal?: (tabId: string) => void
  onFocusChat?: (tabId: string) => void
  onFocusHostTerminal?: () => void
  onHostPublished?: () => void
  onStructuredLaunched?: (sessionId: string) => void
}

/** One launch request: a menu row (with its surface and host) or a bare agent from a controller. */
type MenuLaunchRequest = {
  agent: TuiAgent
  requestedSurface?: NonNullable<LaunchAgentInNewTabArgs['requestedSurface']>
  selectedExecutionHostId?: LaunchAgentInNewTabArgs['selectedExecutionHostId']
  rowExecutionHostId?: ExecutionHostId
  draft?: AgentPickerDraft
  pickerEntry?: AgentPickerEntry
}

/** The single launch path behind the tab bar, the session grid and the review-notes menu. */
function launchFromMenu(ctx: MenuLaunchContext, request: MenuLaunchRequest): void {
  const { agent, draft, pickerEntry } = request
  const label = getCatalogEntry(agent)?.label ?? agent
  const executionHostId = ctx.executionHostId ?? request.rowExecutionHostId
  const result = launchAgentInNewTab({
    requestId: newAgentLaunchRequestId(),
    focusIntent: captureNativeChatComposerFocusIntent(),
    ...(request.requestedSurface
      ? {
          requestedSurface: request.requestedSurface,
          selectedExecutionHostId: request.selectedExecutionHostId
        }
      : {}),
    agent,
    ...(draft ? agentPickerLaunchInputs(draft, pickerEntry) : {}),
    worktreeId: ctx.worktreeId,
    groupId: ctx.groupId,
    ...(executionHostId ? { executionHostId } : {}),
    ...(ctx.activate !== undefined ? { activate: ctx.activate } : {}),
    ...(ctx.prompt !== undefined ? { prompt: ctx.prompt } : {}),
    ...(ctx.promptDelivery !== undefined ? { promptDelivery: ctx.promptDelivery } : {}),
    ...(ctx.launchSource !== undefined ? { launchSource: ctx.launchSource } : {}),
    ...(ctx.onPromptDelivered !== undefined ? { onPromptDelivered: ctx.onPromptDelivered } : {}),
    // Notes keep their text until it goes out, so the new chat's composer never gets a copy.
    ...(ctx.onPromptHandedOff ? { promptKeptByCaller: true as const } : {})
  })
  if (!result) {
    toast.error(
      translate(
        'auto.components.tab.bar.QuickLaunchButton.465e432ef1',
        'Could not build launch command for {{value0}}.',
        { value0: label }
      )
    )
    return
  }
  if (ctx.onPromptHandedOff && result.promptDeliveryResult) {
    const outcome = newAgentPromptOutcome({ delivery: result.promptDeliveryResult })
    ctx.onPromptHandedOff(outcome)
    // The notes keep the text, so they say once why it did not go, as a send to a chat does.
    void outcome.then(({ failure }) => {
      if (failure) {
        toast.error(
          translate('auto.store.slices.ui.53883b7bc3', "Couldn't send to {{value0}}", {
            value0: label
          }),
          {
            description: activeAgentNotesSendFailureMessage(failure.status, {
              explicitTarget: true,
              code: failure.code
            })
          }
        )
      }
    })
  }
  const notifyStructured = (): void => {
    if (result.structuredSettlement && ctx.onStructuredLaunched) {
      void result.structuredSettlement.then((settlement) => {
        if (settlement.kind === 'structured' || settlement.kind === 'visibility-unknown') {
          ctx.onStructuredLaunched?.(settlement.sessionId)
        }
      })
    }
  }
  if (result.surface.kind === 'local-chat') {
    ctx.onFocusChat?.(result.surface.tabId)
    notifyStructured()
    return
  }
  if (result.surface.kind === 'host-published') {
    ctx.onHostPublished?.()
    ctx.onFocusHostTerminal?.()
    notifyStructured()
    // Why: paired web clients create the tab on the host; focus follows the
    // next session-tabs snapshot instead of a local tab id.
    return
  }
  const launchedTabId = result.surface.tabId
  ctx.onLaunched?.(launchedTabId)
  ctx.onFocusTerminal?.(launchedTabId)

  // Why: launch success means the terminal session exists. Agent readiness
  // can lag behind on slow machines, and prompt paste flows already own
  // their own readiness timeout once a PTY exists.
  void waitForTerminalPty(launchedTabId, 5000).then((hasPty) => {
    if (hasPty) {
      return
    }
    const launchState = getTerminalLaunchState(launchedTabId)
    if (!launchState.stillOpen) {
      return
    }
    const store = useAppStore.getState()
    if (
      !shouldShowLaunchWatchdogTimeout({
        hasPty: launchState.hasPty,
        isWorktreeActive: store.activeWorktreeId === ctx.worktreeId,
        activeView: store.activeView
      })
    ) {
      return
    }
    toast.message(getLaunchWatchdogTimeoutMessage(label))
  })
}

/** Structured-chat launches still starting, per agent; the row waits on them. */
function useStructuredLaunchPendingAgents(
  worktreeId: string | undefined
): (agent: TuiAgent) => boolean {
  // One hook per structured provider: the launch registry is keyed by agent, and hooks cannot run
  // inside the agent list's render loop.
  const claudeStatus = useSyncExternalStore(
    subscribeStructuredAgentLaunchStatus,
    () => (worktreeId ? getStructuredAgentLaunchStatus(worktreeId, 'claude') : 'idle'),
    () => 'idle'
  )
  const codexStatus = useSyncExternalStore(
    subscribeStructuredAgentLaunchStatus,
    () => (worktreeId ? getStructuredAgentLaunchStatus(worktreeId, 'codex') : 'idle'),
    () => 'idle'
  )
  return (agent) => {
    const status = agent === 'claude' ? claudeStatus : agent === 'codex' ? codexStatus : 'idle'
    return isAgentSessionHandleProvider(agent) && status === 'pending'
  }
}

/** What a launch surface needs to list and start agents, with none of the menu markup. */
export type QuickLaunchAgentsController = {
  /** Enabled detected agents in catalog order, the user's default first. */
  agents: TuiAgent[]
  /** Null while detection has not answered; empty when the host reports none. */
  detectedIds: TuiAgent[] | null
  defaultAgent: TuiAgent | 'blank' | null | undefined
  /** The new-agent shortcut label, shown against the default agent only. */
  newAgentShortcut: string | null
  labelFor: (agent: TuiAgent) => string
  /** A structured native-chat launch for this agent is still starting; the row waits on it. */
  isLaunchPending: (agent: TuiAgent) => boolean
  runLaunch: (agent: TuiAgent) => void
  openAgentSettings: () => void
}

/**
 * The launch logic behind `QuickLaunchAgentMenuItems`, for a surface that renders its own
 * rows (the session grid's Command picker). Detection, ordering, the launch call and its
 * watchdog live here once, so the two surfaces cannot drift apart.
 */
export function useQuickLaunchAgents({
  worktreeId,
  executionHostId,
  groupId,
  onLaunched,
  onFocusTerminal,
  onStructuredLaunched,
  onHostPublished,
  prompt,
  promptDelivery,
  launchSource,
  onPromptDelivered,
  onPromptHandedOff,
  disabled = false,
  activate
}: QuickLaunchAgentMenuItemsProps): QuickLaunchAgentsController {
  // Why: resolving only the SSH connectionId here made paired-runtime
  // worktrees fall back to LOCAL detection, listing the client's agents
  // instead of the remote server's. Use the same ssh/runtime/local owner
  // resolution as the rest of the tab bar.
  const agentDetectionTarget = useAgentDetectionTargetForWorktree(worktreeId, executionHostId)
  const { detectedIds } = useDetectedAgents(agentDetectionTarget)
  const defaultAgent = useAppStore((s) => s.settings?.defaultTuiAgent)
  const disabledAgents = useAppStore(
    (s) => s.settings?.disabledTuiAgents ?? DEFAULT_DISABLED_TUI_AGENTS
  )
  const openSettingsPage = useAppStore((s) => s.openSettingsPage)
  const openSettingsTarget = useAppStore((s) => s.openSettingsTarget)
  const newAgentShortcut = useOptionalShortcutLabel('tab.newAgent')
  const isLaunchPending = useStructuredLaunchPendingAgents(worktreeId)

  const openAgentSettings = useCallback(() => {
    openSettingsTarget({ pane: 'agents', repoId: null })
    openSettingsPage()
  }, [openSettingsPage, openSettingsTarget])

  const runLaunch = useCallback(
    (agent: TuiAgent) => {
      if (disabled) {
        return
      }
      launchFromMenu(
        {
          worktreeId,
          executionHostId,
          groupId,
          prompt,
          promptDelivery,
          launchSource,
          activate,
          onPromptDelivered,
          onPromptHandedOff,
          onLaunched,
          onFocusTerminal,
          onHostPublished,
          onStructuredLaunched
        },
        { agent }
      )
    },
    [
      worktreeId,
      executionHostId,
      groupId,
      onLaunched,
      onFocusTerminal,
      onStructuredLaunched,
      onHostPublished,
      prompt,
      promptDelivery,
      launchSource,
      activate,
      onPromptDelivered,
      onPromptHandedOff,
      disabled
    ]
  )

  const enabledDetectedIds = detectedIds ? filterEnabledTuiAgents(detectedIds, disabledAgents) : []
  const agents = detectedIds ? orderAgents(defaultAgent, enabledDetectedIds) : []
  const labelFor = useCallback((agent: TuiAgent) => getCatalogEntry(agent)?.label ?? agent, [])

  return {
    agents,
    detectedIds,
    defaultAgent,
    newAgentShortcut,
    labelFor,
    isLaunchPending,
    runLaunch,
    openAgentSettings
  }
}

export function useTabAgentMenuLaunch({
  worktreeId,
  groupId,
  onFocusTerminal,
  prompt,
  promptDelivery,
  launchSource,
  onPromptDelivered,
  onPromptHandedOff,
  disabled,
  onFocusHostTerminal,
  onFocusChat,
  executionHostId,
  activate,
  onLaunched,
  onHostPublished,
  onStructuredLaunched
}: QuickLaunchAgentMenuItemsProps & {
  onFocusHostTerminal?: () => void
  /** A New Chat opened at once: its composer takes the focus the menu gives back. */
  onFocusChat?: (tabId: string) => void
}) {
  const runLaunch = useCallback(
    (row: NewTabAgentMenuRow, draft?: AgentPickerDraft, pickerEntry?: AgentPickerEntry) => {
      if (disabled || row.kind === 'chat-unavailable') {
        return
      }
      // Why: a chat or CLI row names its own host, which routes the launch when the surface lists several.
      const surfaceRow = row.kind === 'chat' || row.kind === 'cli' ? row : null
      launchFromMenu(
        {
          worktreeId,
          executionHostId,
          groupId,
          prompt,
          promptDelivery,
          launchSource,
          activate,
          onPromptDelivered,
          onPromptHandedOff,
          onLaunched,
          onFocusTerminal,
          onFocusChat,
          onFocusHostTerminal,
          onHostPublished,
          onStructuredLaunched
        },
        {
          agent: row.agent,
          ...(surfaceRow
            ? {
                requestedSurface: surfaceRow.kind === 'chat' ? ('chat' as const) : ('terminal' as const),
                selectedExecutionHostId: surfaceRow.executionHostId,
                rowExecutionHostId: surfaceRow.executionHostId
              }
            : {}),
          draft,
          pickerEntry
        }
      )
    },
    [
      worktreeId,
      groupId,
      onFocusTerminal,
      prompt,
      promptDelivery,
      launchSource,
      onPromptDelivered,
      onPromptHandedOff,
      disabled,
      onFocusHostTerminal,
      onFocusChat,
      executionHostId,
      activate,
      onLaunched,
      onHostPublished,
      onStructuredLaunched
    ]
  )

  return runLaunch
}

function QuickLaunchAgentMenuItemsInner(props: QuickLaunchAgentMenuItemsProps): React.JSX.Element {
  useUiLanguageRevision()
  const detectionTarget = useAgentDetectionTargetForWorktree(props.worktreeId, props.executionHostId)
  const model = useNewTabAgentMenuRows(props.worktreeId, true, detectionTarget)
  const runLaunch = useTabAgentMenuLaunch(props)
  return (
    <ProjectedAgentMenuItems
      {...props}
      model={model}
      runLaunch={runLaunch}
      launchPendingWorktreeId={props.worktreeId}
    />
  )
}

export function ProjectedAgentMenuItems({
  disabled = false,
  model,
  runLaunch,
  pickerInventory,
  onSelectPickerAgent,
  hidePickerSearch,
  launchPendingWorktreeId
}: {
  disabled?: boolean
  model: NewTabAgentMenuModel
  runLaunch: (row: NewTabAgentMenuRow, draft?: AgentPickerDraft) => void
  pickerInventory?: AgentPickerInventorySource
  onSelectPickerAgent?: (agent: AgentPickerEntry['agent']) => void
  hidePickerSearch?: boolean
  /** The worktree whose structured chat launches show as pending on their rows. */
  launchPendingWorktreeId?: string
}): React.JSX.Element {
  const desktopDefaultAgent = useAppStore((s) => s.settings?.defaultTuiAgent)
  const openSettingsPage = useAppStore((s) => s.openSettingsPage)
  const openSettingsTarget = useAppStore((s) => s.openSettingsTarget)
  const newAgentShortcut = useOptionalShortcutLabel('tab.newAgent')
  const shortcutLabels = useAgentMenuShortcutLabels(pickerInventory ? model : undefined)
  const isLaunchPending = useStructuredLaunchPendingAgents(launchPendingWorktreeId)
  const openAgentSettings = useCallback(() => {
    openSettingsTarget({ pane: 'agents', repoId: null })
    openSettingsPage()
  }, [openSettingsPage, openSettingsTarget])
  if (model.state === 'loading') {
    // Why: rows fill in once when every answer is known, instead of reshuffling under the pointer.
    return (
      <>
        {PLACEHOLDER_WIDTHS.slice(0, model.placeholderCount).map((width) => (
          <DropdownMenuItem
            key={width}
            variant="launch"
            disabled
            aria-label={translate(
              'auto.components.tab.bar.QuickLaunchButton.agentsLoading',
              'Loading agents'
            )}
          >
            <span aria-hidden="true" className="flex h-[1lh] flex-1 items-center">
              <span className={cn('h-2 rounded-full bg-muted', width)} />
            </span>
          </DropdownMenuItem>
        ))}
        <AgentSettingsMenuItem onSelect={openAgentSettings} />
      </>
    )
  }
  const {
    rows,
    detection: { detectedIds, detectionFailed, needsServerUpdate }
  } = model
  const defaultAgent = 'defaultTuiAgent' in model ? model.defaultTuiAgent : desktopDefaultAgent
  return (
    <>
      {(detectedIds === null && (detectionFailed || needsServerUpdate)) || rows.length === 0 ? (
        <DropdownMenuItem
          disabled
          className="gap-2 rounded-[7px] px-2 py-1.5 text-[12px] leading-5 text-muted-foreground"
        >
          {needsServerUpdate
            ? translate(
                'auto.components.tab.bar.QuickLaunchButton.terminalListNeedsServerUpdate',
                'Update Orca on this server to list terminal agents'
              )
            : detectionFailed
              ? translate(
                  'auto.components.tab.bar.QuickLaunchButton.terminalListFailed',
                  'Couldn’t list terminal agents for this workspace'
                )
              : detectedIds && detectedIds.length > 0
                ? translate(
                    'auto.components.tab.bar.QuickLaunchButton.8dea9b5cdf',
                    'No enabled agents'
                  )
                : translate(
                    'auto.components.tab.bar.QuickLaunchButton.e518f544b1',
                    'No agents detected'
                  )}
        </DropdownMenuItem>
      ) : null}
      {pickerInventory ? (
        <SubscribedAgentLaunchPickerMenu
          shortcutLabels={shortcutLabels}
          inventory={pickerInventory}
          runLaunch={runLaunch}
          onSelectAgent={onSelectPickerAgent}
          hideSearch={hidePickerSearch}
        />
      ) : (
        rows.map((row, index) => {
          const { agent } = row
          const label = getCatalogEntry(agent)?.label ?? agent
          // Chat rows come first; the rows that open a terminal start their own group.
          const startsCliGroup = row.kind === 'cli' && index > 0 && rows[index - 1]?.kind !== 'cli'
          if (row.kind === 'chat-unavailable') {
            return (
              <DropdownMenuItem key={rowId(row)} variant="launch" disabled>
                <AgentIcon agent={agent} size={14} />
                <span className="flex-1">{label}</span>
                <span className="font-normal text-muted-foreground">
                  {chatUnavailableLabel(row.reason)}
                </span>
              </DropdownMenuItem>
            )
          }
          // Why: a structured chat still starting cannot take a second click until it settles.
          const pending = row.kind === 'chat' && isLaunchPending(agent)
          const rowDisabled = disabled || pending
          const showsDefaultAgentShortcut =
            newAgentShortcut !== null && defaultAgent !== 'blank' && agent === defaultAgent
          const rowContent = (
            <>
              {pending ? (
                <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden="true" />
              ) : (
                <AgentIcon agent={agent} size={14} />
              )}
              <span className="flex-1">{rowLabel(row)}</span>
              {showsDefaultAgentShortcut ? (
                <DropdownMenuShortcut>{newAgentShortcut}</DropdownMenuShortcut>
              ) : null}
            </>
          )
          const other = otherSurfaceRow(row, detectedIds)
          return (
            <React.Fragment key={rowId(row)}>
              {startsCliGroup ? <DropdownMenuSeparator /> : null}
              {other ? (
                <SurfaceChoiceRow
                  row={row}
                  other={other}
                  label={label}
                  disabled={rowDisabled}
                  runLaunch={runLaunch}
                >
                  {rowContent}
                </SurfaceChoiceRow>
              ) : (
                <DropdownMenuItem
                  variant="launch"
                  disabled={rowDisabled}
                  onSelect={() => runLaunch(row)}
                  title={rowTitle(row, label)}
                >
                  {rowContent}
                </DropdownMenuItem>
              )}
            </React.Fragment>
          )
        })
      )}
      <AgentSettingsMenuItem onSelect={openAgentSettings} />
    </>
  )
}

/** The same agent on the other surface: a chat's detected CLI, or a CLI-set agent's chat. */
function otherSurfaceRow(
  row: Exclude<NewTabAgentMenuRow, { kind: 'chat-unavailable' }>,
  detectedIds: readonly TuiAgent[] | null
): NewTabAgentMenuRow | null {
  const { agent, executionHostId } = row
  if (row.kind === 'chat') {
    return detectedIds?.includes(agent) ? { kind: 'cli', agent, executionHostId } : null
  }
  return row.kind === 'cli' && row.chat ? { kind: 'chat', agent, executionHostId } : null
}

// Why: the row starts its own surface; its trailing button (or ArrowRight, then Enter) opens the other.
function SurfaceChoiceRow({
  row,
  other,
  label,
  disabled,
  runLaunch,
  children
}: {
  row: NewTabAgentMenuRow
  other: NewTabAgentMenuRow
  label: string
  disabled: boolean
  runLaunch: (row: NewTabAgentMenuRow) => void
  children: React.ReactNode
}): React.JSX.Element {
  const otherButton = useRef<HTMLButtonElement>(null)
  const releaseTarget = useRef<{ event: PointerEvent; target: EventTarget } | null>(null)
  const title = rowTitle(row, label)
  return (
    <DropdownMenuItem
      variant="launch"
      disabled={disabled}
      title={title}
      aria-label={title}
      onPointerUp={(event) => {
        // Radix synchronously clicks the row on drag release, discarding the release target.
        const release = { event: event.nativeEvent, target: event.target }
        releaseTarget.current = release
        queueMicrotask(() => {
          if (releaseTarget.current === release) {
            releaseTarget.current = null
          }
        })
      }}
      onClick={(event) => {
        const release = releaseTarget.current
        releaseTarget.current = null
        if (disabled) {
          return
        }
        const target =
          event.target === event.currentTarget && release && release.event.eventPhase !== Event.NONE
            ? release.target
            : event.target
        runLaunch(target instanceof Node && otherButton.current?.contains(target) ? other : row)
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight') {
          event.preventDefault()
          otherButton.current?.focus()
        }
      }}
    >
      {children}
      <AgentSurfaceLaunchButton
        ref={otherButton}
        surface={other.kind === 'chat' ? 'chat' : 'terminal'}
        title={rowTitle(other, label)}
        className="hover:bg-accent focus-visible:bg-accent [[data-highlighted]_&]:opacity-100"
        onKeyDown={(event) => {
          // Stopped so the row's own Enter handling does not start the row's surface instead.
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            event.stopPropagation()
            event.currentTarget.click()
          } else if (ROW_NAVIGATION_KEYS.has(event.key)) {
            event.preventDefault()
            event.stopPropagation()
            const item = event.currentTarget.closest<HTMLElement>('[role="menuitem"]')
            item?.focus()
            // Why: roving focus ignores keys from inside an item, so the row replays the move.
            if (event.key !== 'ArrowLeft') {
              item?.dispatchEvent(new KeyboardEvent('keydown', { key: event.key, bubbles: true }))
            }
          }
        }}
      />
    </DropdownMenuItem>
  )
}

function AgentSettingsMenuItem({ onSelect }: { onSelect: () => void }): React.JSX.Element {
  return (
    <DropdownMenuItem
      onSelect={onSelect}
      className="gap-2 rounded-[7px] px-2 py-1.5 text-[12px] leading-5 font-medium text-muted-foreground"
    >
      <SettingsIcon className="size-4" />
      {translate('auto.components.tab.bar.QuickLaunchButton.348a04c1ad', 'Agent settings…')}
    </DropdownMenuItem>
  )
}

export const QuickLaunchAgentMenuItems = React.memo(QuickLaunchAgentMenuItemsInner)
