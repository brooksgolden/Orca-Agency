import type { AgentStatus } from '../../shared/agent-detection'
import type { RuntimeStore } from './runtime-store-contract'
import type { RuntimePtyWorktreeRecord } from './runtime-terminal-state-records'
import type { OrcaRuntimeService } from './orca-runtime'
import { CodexCapacityRecovery } from './codex-capacity-recovery'
import { startSpan } from '../observability/tracer'
import { createCodexCapacityGoalSubmitGuard } from './codex-capacity-goal-submit'
import { isCodexCapacitySafeChrome } from './codex-capacity-screen'
import type { AgentStatusState } from '../../shared/agent-status-types'
import type { AgentTurnOutcome } from '../../shared/agent-turn-outcome'
import {
  detectCodexCapacityFailure,
  type CodexCapacityFailureKind
} from './codex-capacity-stream-failure'

type CapacityRecoveryRuntime = Pick<
  OrcaRuntimeService,
  | 'readTerminal'
  | 'readLaunchedAgentForeground'
  | 'sendTerminal'
  | 'getPtyOutputSequence'
  | 'terminalRunFacts'
> & {
  store: RuntimeStore | null
  ptysById: Map<string, RuntimePtyWorktreeRecord>
  agentPromptLifecycleByPtyId: Map<string, { status: AgentStatus | null; workingSequence: number }>
  getPtyLifecycleGeneration(ptyId: string): number
  issuePtyHandle(pty: RuntimePtyWorktreeRecord): string
  getAgentPromptActivity(handle: string, ptyId: string): CapacityRecoveryActivity
}

type CapacityRecoveryActivity = {
  status: AgentStatus | null
  explicitWorkingStartedAt: number | null
  mainAgentState?: AgentStatusState
  mainAgentOutcome?: AgentTurnOutcome
}

export function canRecoverCodexCapacity(
  activity: CapacityRecoveryActivity,
  failureKind: CodexCapacityFailureKind = 'capacity'
): boolean {
  if (activity.status === 'permission') {
    return false
  }
  // A completed failing lead can leave the aggregate row working while helpers
  // finish. That child-folded state must not suppress recovery of the lead.
  if (
    activity.mainAgentState === 'done' &&
    (activity.mainAgentOutcome === 'failure' || failureKind === 'bad-request')
  ) {
    return true
  }
  // A title spinner can outlive the error. The rendered error/composer check proves idle then.
  return activity.status === 'idle' || activity.explicitWorkingStartedAt === null
}

const isComposer = (line: string): boolean => /^\s*[\u203a>]/.test(line)

const isEmptyComposer = (line: string): boolean =>
  /^\s*[\u203a>]\s*Ask Codex to do anything\s*$/.test(line)

const isCodexFooter = (line: string): boolean =>
  /^\s*(?:GPT-|o\d)[^\n]*\s(?:default|minimal|none|low|medium|high|xhigh|max|ultra)\s+[\u00b7\u2022]\s+\S/.test(
    line
  )

const isRecapCommand = (line: string): boolean =>
  /^\s*[\u203a>]\s*\/recap(?:\s+summarize the current conversation now)?\s*$/.test(line)

const isRecapStatus = (line: string): boolean =>
  /^\s*\u2022\s*Generating conversation recap(?:\u2026|\.\.\.)?\s*$/.test(line)

/**
 * Reconstruct only a still-current provider failure. Stream history contains
 * repaint epochs, so all rows after the newest notice must be classified. A
 * later question, completion, prompt, or other substantive output invalidates
 * recovery even when it has already scrolled above a short visible pane.
 */
function recentFailureHistoryWithRecap(lines: string[], ownedDraft?: string): string[] {
  let failureStart = -1
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (detectCodexCapacityFailure(lines.slice(index, index + 24).join('\n'))) {
      failureStart = index
      break
    }
  }
  if (failureStart === -1) {
    return []
  }

  const evidence = lines.slice(failureStart)
  let failureEnd = -1
  for (let index = 0; index < Math.min(evidence.length, 24); index += 1) {
    if (detectCodexCapacityFailure(evidence.slice(0, index + 1).join('\n'))) {
      failureEnd = index
      break
    }
  }
  if (failureEnd === -1) {
    return []
  }

  const failure = evidence.slice(0, failureEnd + 1)
  const recap: string[] = []
  let inRecap = false
  for (const line of evidence.slice(failureEnd + 1)) {
    if (!line.trim() || isEmptyComposer(line) || isCodexFooter(line)) {
      if (isEmptyComposer(line)) {
        inRecap = false
      }
      continue
    }
    if (isRecapCommand(line) || isRecapStatus(line)) {
      inRecap = false
      continue
    }
    const trimmed = line.trim()
    if (
      ownedDraft &&
      (trimmed === ownedDraft ||
        trimmed === `\u203a ${ownedDraft}` ||
        trimmed === `> ${ownedDraft}`)
    ) {
      continue
    }
    if (isCodexCapacitySafeChrome(line)) {
      inRecap = false
      continue
    }
    if (/^\s{0,2}\u21b3 Recap:\s+\S/.test(line)) {
      inRecap = true
      recap.push(line)
      continue
    }
    if (inRecap && /^\s{3,}\S/.test(line) && !isComposer(line) && !/^\s*\u2022/.test(line)) {
      recap.push(line)
      continue
    }
    if (detectCodexCapacityFailure(line)) {
      continue
    }
    return []
  }
  return [...failure, ...recap]
}

function renderedEmptyCodexComposer(lines: string[]): boolean {
  const nonempty = lines.filter((line) => line.trim())
  const prompt = nonempty.at(-2) ?? ''
  const footer = nonempty.at(-1) ?? ''
  return /^\s*[\u203a>]\s*Ask Codex to do anything\s*$/.test(prompt) && isCodexFooter(footer)
}

function mergeWithoutDuplicateRows(history: string[], visible: string[]): string[] {
  const left = history.filter((line) => line.trim())
  const right = visible.filter((line) => line.trim())
  let overlap = Math.min(left.length, right.length)
  while (overlap > 0 && left.slice(-overlap).join('\n') !== right.slice(0, overlap).join('\n')) {
    overlap -= 1
  }
  return [...left, ...right.slice(overlap)]
}

export async function readCapacityRecoveryScreen(
  runtime: CapacityRecoveryRuntime,
  handle: string
): Promise<Awaited<ReturnType<CapacityRecoveryRuntime['readTerminal']>>> {
  const visible = await runtime.readTerminal(handle, { screen: true, limit: 80 })
  if (visible.source !== 'screen') {
    return visible
  }
  const history = await runtime.readTerminal(handle, { limit: 240 })
  if (history.source !== 'stream' || history.tail.length === 0) {
    return visible
  }
  const ownedDraft =
    visible.composerState === 'draft' &&
    (visible.draft?.trim() === 'Continue' || visible.draft?.trim() === '/goal resume')
      ? visible.draft.trim()
      : undefined
  const failureHistory = recentFailureHistoryWithRecap(history.tail, ownedDraft)
  if (failureHistory.length === 0) {
    return visible
  }
  // Keep visible composer proof authoritative. A short pane can hide the recap
  // header and cursor metadata while still showing the exact empty placeholder
  // and footer, so recover that state without accepting an arbitrary draft.
  const composerState =
    visible.composerState === 'unknown' &&
    !visible.draft &&
    renderedEmptyCodexComposer(visible.tail)
      ? 'empty'
      : visible.composerState
  return {
    ...visible,
    composerState,
    tail: mergeWithoutDuplicateRows(failureHistory, visible.tail)
  }
}

export function createRuntimeCodexCapacityRecovery(
  runtime: CapacityRecoveryRuntime
): CodexCapacityRecovery {
  const ptyHandle = (ptyId: string): string => {
    const pty = runtime.ptysById.get(ptyId)
    if (!pty) {
      throw new Error('terminal_handle_stale')
    }
    return runtime.issuePtyHandle(pty)
  }
  return new CodexCapacityRecovery({
    enabled: () => runtime.store?.getSettings().codexCapacityAutoContinue === true,
    current: (ptyId) => {
      const pty = runtime.ptysById.get(ptyId)
      // The execution host owns retry input; clients never drive an SSH/WSL host's retry.
      if (
        !pty?.connected ||
        pty.connectionId ||
        pty.isWsl ||
        (pty.foregroundAgent ?? pty.launchAgent) !== 'codex'
      ) {
        return null
      }
      const lifecycle = runtime.agentPromptLifecycleByPtyId.get(ptyId)
      return {
        generation: runtime.getPtyLifecycleGeneration(ptyId),
        inputSequence: runtime.terminalRunFacts.readInputSequence(ptyId),
        workingSequence: lifecycle?.workingSequence ?? 0,
        status: lifecycle?.status ?? pty.lastAgentStatus,
        outputSequence: runtime.getPtyOutputSequence(ptyId)
      }
    },
    screen: (ptyId) => readCapacityRecoveryScreen(runtime, ptyHandle(ptyId)),
    canRecover: (ptyId, failureKind) =>
      canRecoverCodexCapacity(runtime.getAgentPromptActivity(ptyHandle(ptyId), ptyId), failureKind),
    sendContinue: async (ptyId, reserveWrite, command, submitExistingDraft = false) => {
      if ((await runtime.readLaunchedAgentForeground(ptyId, 'codex')) === 'shell') {
        return { sent: false, reason: 'capacity_recovery_agent_not_foreground' }
      }
      // Both commands share one guarded route: the Enter is written only after the exact draft renders.
      const handle = ptyHandle(ptyId)
      let guardFailure: string | undefined
      const guard = createCodexCapacityGoalSubmitGuard({
        expectedCommand: command,
        initialGeneration: runtime.getPtyLifecycleGeneration(ptyId),
        initialInputSequence:
          runtime.terminalRunFacts.readInputSequence(ptyId) - (submitExistingDraft ? 1 : 0),
        initialReservations: submitExistingDraft ? 1 : 0,
        getGeneration: () => runtime.getPtyLifecycleGeneration(ptyId),
        getInputSequence: () => runtime.terminalRunFacts.readInputSequence(ptyId),
        readScreen: () => runtime.readTerminal(handle, { screen: true, limit: 80 }),
        wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms))
      })
      const result = await runtime.sendTerminal(
        handle,
        submitExistingDraft ? { enter: true } : { text: command, enter: true },
        {
          inputKind: 'driving',
          beforeWrite: async () => {
            try {
              await guard.beforeWrite()
            } catch (error) {
              guardFailure =
                error instanceof Error ? error.message : 'capacity_recovery_preflight_failed'
              throw error
            }
          },
          reserveWrite: () => {
            reserveWrite()
            guard.recordReservation()
          },
          requireWriteSettlement: true
        }
      )
      const settlementReason =
        result.writeSettlement && result.writeSettlement.outcome !== 'accepted'
          ? result.writeSettlement.reason
          : undefined
      return {
        sent: result.accepted,
        ...(guardFailure
          ? { reason: guardFailure }
          : settlementReason
            ? { reason: settlementReason }
            : {})
      }
    },
    report: (ptyId, outcome, attempt, reason) => {
      startSpan('codex.capacity.recovery', {
        attributes: { ptyId, outcome, attempt, reason: reason ?? 'none' }
      }).end()
      console.info(
        `[codex-capacity-recovery] ${outcome} attempt=${attempt} reason=${reason ?? 'none'} pty=${ptyId}`
      )
    }
  })
}
