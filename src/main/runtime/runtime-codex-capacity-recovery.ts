import type { AgentStatus } from '../../shared/agent-detection'
import type { RuntimeStore } from './runtime-store-contract'
import type { RuntimePtyWorktreeRecord } from './runtime-terminal-state-records'
import type { OrcaRuntimeService } from './orca-runtime'
import { CodexCapacityRecovery } from './codex-capacity-recovery'

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
    screen: (ptyId) => runtime.readTerminal(ptyHandle(ptyId), { screen: true, limit: 80 }),
    sendContinue: async (ptyId, reserveWrite) => {
      if ((await runtime.readLaunchedAgentForeground(ptyId, 'codex')) === 'shell') {
        return false
      }
      const result = await runtime.sendTerminal(
        ptyHandle(ptyId),
        { text: '\x1b[200~Continue\x1b[201~\r' },
        {
          inputKind: 'driving',
          reserveWrite,
          requireWriteSettlement: true
        }
      )
      return result.accepted
    },
    report: (ptyId, outcome, attempt) =>
      console.info(`[codex-capacity-recovery] ${outcome} attempt=${attempt} pty=${ptyId}`)
  })
}
