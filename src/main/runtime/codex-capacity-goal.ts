import type { RuntimeTerminalRead } from '../../shared/runtime-terminal-read'
import type { CodexCapacityState } from './codex-capacity-recovery'

type GoalState = 'active' | 'stalled' | 'paused' | 'unknown'

export function capacityGoalFooterState(footer: string): GoalState {
  const match =
    /^\s*G[A-Za-z0-9.\-…]*(?: [^\n]*?)? (Pursuing goal \([\d dhms]+\)|Goal (stalled|paused) \(\/goal resume\))\s*(?:⚠\s*\d+ (.*?))?\s*$/.exec(
      footer
    )
  if (!match) {
    return 'unknown'
  }
  const warnings = match[3]
  if (
    warnings !== undefined &&
    !['warning · f2 to view', 'warnings · f2 to view'].some((full) =>
      warnings.endsWith('…') ? full.startsWith(warnings.slice(0, -1)) : warnings === full
    )
  ) {
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
    workingSequence: number
  } | null = null

  observe(lines: string[], expected: CodexCapacityState): void {
    const footer = lines.findLast((line) => line.trim() !== '') ?? ''
    if (!/^\s*(?:GPT-[A-Za-z0-9.-]+…?|G(?:P(?:T)?)?…)\s/.test(footer)) {
      return
    }
    const state = capacityGoalFooterState(footer)
    if (state !== 'active' && expected.status === 'working') {
      // A capacity repaint can draw the stalled footer before its split OSC error
      // updates lifecycle state. That intermediate frame is part of the interruption,
      // not proof the goal was already stalled before it.
      return
    }
    this.observation = {
      state,
      generation: expected.generation,
      input: expected.inputSequence,
      workingSequence: expected.workingSequence
    }
  }

  wasActive(expected: CodexCapacityState): boolean {
    const prior = this.observation
    return (
      prior?.state === 'active' &&
      prior.generation === expected.generation &&
      prior.input === expected.inputSequence &&
      prior.workingSequence === expected.workingSequence
    )
  }
}
