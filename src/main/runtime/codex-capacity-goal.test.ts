import { describe, expect, it } from 'vitest'
import { capacityGoalState, CodexCapacityGoal } from './codex-capacity-goal'
import type { CodexCapacityState } from './codex-capacity-recovery'
import type { RuntimeTerminalRead } from '../../shared/runtime-terminal-read'

const ACTIVE = 'GP… Pursuing goal (1d 14h 32m)    ⚠ 2 warnings · f2 to view'
function screen(tail: string[]): RuntimeTerminalRead {
  return {
    handle: 'goal',
    status: 'running',
    source: 'screen',
    tail,
    truncated: false,
    nextCursor: null
  }
}
function state(): CodexCapacityState {
  return {
    generation: 1,
    inputSequence: 1,
    workingSequence: 1,
    outputSequence: 1,
    status: 'working'
  }
}

describe('capacity recovery prior rendered goal state', () => {
  it('reads a goal with a clipped warnings suffix but rejects unrelated footer text', () => {
    expect(capacityGoalState(screen(['G… Goal stalled (/goal resume)  ⚠ 2 warnin…']))).toBe(
      'stalled'
    )
    expect(
      capacityGoalState(screen(['G… Goal stalled (/goal resume)  ⚠ 2 Choose an option']))
    ).toBe('unknown')
  })
  it('reads only the footer, not a quoted status in conversation', () => {
    expect(capacityGoalState(screen([ACTIVE]))).toBe('active')
    expect(capacityGoalState(screen([ACTIVE, '› my unsent draft']))).toBe('unknown')
    expect(capacityGoalState({ ...screen([ACTIVE]), source: 'screen-unavailable' })).toBe('unknown')
  })
  it.each(['generation', 'inputSequence'] as const)(
    'does not reuse active state across changed %s',
    (field) => {
      const current = state()
      const goal = new CodexCapacityGoal()
      goal.observe([ACTIVE], current)
      expect(goal.wasActive(current)).toBe(true)
      current[field]++
      expect(goal.wasActive(current)).toBe(false)
    }
  )
  it('does not reuse active-goal evidence across lifecycle working turns', () => {
    const current = state()
    const goal = new CodexCapacityGoal()
    goal.observe([ACTIVE], current)
    current.workingSequence++
    expect(goal.wasActive(current)).toBe(false)
  })
  it('replaces active state with paused, stalled, cleared or unknown rendered chrome', () => {
    const current = state()
    const goal = new CodexCapacityGoal()
    for (const footer of [
      'G… Goal paused (/goal resume)',
      'G… Goal stalled (/goal resume)',
      'GPT-6.1-Sol default'
    ]) {
      goal.observe([ACTIVE], current)
      const idle = { ...current, status: 'idle' as const }
      goal.observe([footer], idle)
      expect(goal.wasActive(idle)).toBe(false)
    }
  })
})
