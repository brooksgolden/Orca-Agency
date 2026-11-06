import type { CodexCapacityGoal } from './codex-capacity-goal'
import type { CodexCapacityState } from './codex-capacity-recovery-types'

export type CodexCapacityRecoveryEntry = {
  generation: number
  carry: string
  sawWorking: boolean
  lastFailureTurn: number
  attempts: number[]
  priorFailureTurn: number
  awaitingFreshOutput: boolean
  handledFailureTurn: number
  timer?: ReturnType<typeof setTimeout>
  pending: boolean
  baseline?: CodexCapacityState
  lastWorkingSequence: number
  lastInputSequence: number
  goal: CodexCapacityGoal
  parkedCommand?: 'Continue' | '/goal resume'
  pendingStartedAt?: number
  attemptRecorded: boolean
}
