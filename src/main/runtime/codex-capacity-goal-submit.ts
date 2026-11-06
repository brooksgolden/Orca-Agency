import type { RuntimeTerminalRead } from '../../shared/runtime-terminal-read'

const GOAL_DRAFT_RENDER_TIMEOUT_MS = 60_000
const GOAL_DRAFT_RECHECK_MS = 100

export type CodexCapacityGoalSubmitGuard = {
  beforeWrite: () => Promise<void>
  recordReservation: () => void
}

type CodexCapacityGoalSubmitGuardOptions = {
  /** The exact command whose rendered draft must appear before the Enter is written. */
  expectedCommand: string
  initialGeneration: number
  initialInputSequence: number
  getGeneration: () => number
  getInputSequence: () => number
  readScreen: () => Promise<RuntimeTerminalRead>
  wait: (ms: number) => Promise<void>
  now?: () => number
  initialReservations?: 0 | 1
}

export function createCodexCapacityGoalSubmitGuard(
  options: CodexCapacityGoalSubmitGuardOptions
): CodexCapacityGoalSubmitGuard {
  let reservations = options.initialReservations ?? 0
  const now = options.now ?? Date.now
  const assertFence = (): void => {
    if (options.getGeneration() !== options.initialGeneration) {
      throw new Error('capacity_recovery_process_changed')
    }
    if (options.getInputSequence() !== options.initialInputSequence + reservations) {
      throw new Error('capacity_recovery_input_changed')
    }
  }

  return {
    beforeWrite: async (): Promise<void> => {
      // The leading text write is deliberately unchanged. Only its separate Enter waits for paint.
      if (reservations === 0) {
        return
      }
      const deadline = now() + GOAL_DRAFT_RENDER_TIMEOUT_MS
      while (true) {
        assertFence()
        const screen = await options.readScreen()
        assertFence()
        if (
          screen.source === 'screen' &&
          screen.composerState === 'draft' &&
          screen.draft?.trim() === options.expectedCommand
        ) {
          return
        }
        if (now() >= deadline) {
          throw new Error('capacity_recovery_goal_composer_unverified')
        }
        await options.wait(GOAL_DRAFT_RECHECK_MS)
        assertFence()
      }
    },
    recordReservation: (): void => {
      assertFence()
      if (reservations >= 2) {
        throw new Error('capacity_recovery_too_many_writes')
      }
      reservations += 1
    }
  }
}
