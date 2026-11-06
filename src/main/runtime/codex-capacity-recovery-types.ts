import type { AgentStatus } from '../../shared/agent-detection'
import type { RuntimeTerminalRead } from '../../shared/runtime-terminal-read'
import type { CodexCapacityFailureKind } from './codex-capacity-stream-failure'

export type CodexCapacityState = {
  generation: number
  inputSequence: number
  workingSequence: number
  status: AgentStatus | null
  outputSequence: number
}

export type CodexCapacityRecoveryPort = {
  enabled(): boolean
  current(ptyId: string): CodexCapacityState | null
  canRecover(ptyId: string, failureKind: CodexCapacityFailureKind): boolean
  screen(ptyId: string): Promise<RuntimeTerminalRead>
  sendContinue(
    ptyId: string,
    reserveWrite: () => void,
    command: 'Continue' | '/goal resume',
    submitExistingDraft?: boolean
  ): Promise<{ sent: boolean; reason?: string }>
  report(
    ptyId: string,
    outcome: 'scheduled' | 'sent' | 'held' | 'exhausted' | 'cancelled',
    attempt: number,
    reason?: string
  ): void
}
