import type { RuntimeTerminalRead } from '../../shared/runtime-terminal-read'
import type { CodexCapacityState } from './codex-capacity-recovery'

type GoalState = 'active' | 'stalled' | 'paused' | 'unknown'

export function capacityGoalFooterState(footer: string): GoalState {
  const match =
    /^\s*G[A-Za-z0-9.\-…]*(?: [^\n]*?)? (Pursuing goal \([\d dhms]+\)|Goal (stalled|paused) \(\/goal resume\))\s*(?:⚠\s*\d+ warnings? · f2 to view)?\s*$/.exec(
      footer
    )
  if (!match) {
    return 'unknown'
  }
  if (match[1]?.startsWith('Pursuing goal')) {
    return 'active'
  }
  return match[2] === 'stalled' ? 'stalled' : 'paused'
}

/** Only terminal chrome, not a goal mentioned in conversation text. */
export function capacityGoalState(read: RuntimeTerminalRead): GoalState {
  if (read.status !== 'running' || read.source !== 'screen') {
    return 'unknown'
  }
  return capacityGoalFooterState(read.tail.findLast((line) => line.trim() !== '') ?? '')
}

/** One rendered observation, scoped to the same process, input and working turn. */
export class CodexCapacityGoal {
  private observation: {
    state: GoalState
    generation: number
    input: number
    turn: number
  } | null = null

  observe(lines: string[], expected: CodexCapacityState): void {
    const footer = lines.findLast((line) => line.trim() !== '') ?? ''
    if (!/^\s*(?:GPT-[A-Za-z0-9.-]+…?|G(?:P(?:T)?)?…)\s/.test(footer)) {
      return
    }
    this.observation = {
      state: capacityGoalFooterState(footer),
      generation: expected.generation,
      input: expected.inputSequence,
      turn: expected.workingSequence
    }
  }

  wasActive(expected: CodexCapacityState): boolean {
    const prior = this.observation
    return (
      prior?.state === 'active' &&
      prior.generation === expected.generation &&
      prior.input === expected.inputSequence &&
      prior.turn === expected.workingSequence
    )
  }
}
