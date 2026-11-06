import { describe, expect, it } from 'vitest'
import { createCodexCapacityGoalSubmitGuard } from './codex-capacity-goal-submit'

function readDraft(draft: string) {
  return {
    handle: 'term-1',
    status: 'running' as const,
    source: 'screen' as const,
    composerState: 'draft' as const,
    draft,
    tail: [],
    truncated: false,
    nextCursor: null
  }
}

function makeGuard(options: {
  expectedCommand?: string
  readScreen: () => ReturnType<typeof readDraft>
  wait?: (ms: number) => Promise<void>
  getGeneration?: () => number
  getInputSequence?: () => number
  now?: () => number
}) {
  return createCodexCapacityGoalSubmitGuard({
    expectedCommand: options.expectedCommand ?? '/goal resume',
    initialGeneration: 3,
    initialInputSequence: 10,
    getGeneration: options.getGeneration ?? (() => 3),
    getInputSequence: options.getInputSequence ?? (() => 10),
    readScreen: async () => options.readScreen(),
    wait: options.wait ?? (async () => undefined),
    now: options.now
  })
}

describe('Codex goal resume rendered submit guard', () => {
  it('leaves the prefix write unblocked and waits until the exact command is rendered before Enter', async () => {
    let now = 0
    let reads = 0
    let sequence = 10
    const guard = makeGuard({
      now: () => now,
      getInputSequence: () => sequence,
      readScreen: () => (++reads === 1 ? readDraft('/goal res') : readDraft('/goal resume')),
      wait: async (ms) => {
        now += ms
      }
    })

    await guard.beforeWrite()
    guard.recordReservation()
    sequence += 1
    await expect(guard.beforeWrite()).resolves.toBeUndefined()
    expect(reads).toBe(2)
  })

  it('holds Enter when only a partial or different command appears before the bound', async () => {
    let now = 0
    let sequence = 10
    const guard = makeGuard({
      now: () => now,
      getInputSequence: () => sequence,
      readScreen: () => readDraft('/goal resum'),
      wait: async (ms) => {
        now += ms
      }
    })
    guard.recordReservation()
    sequence += 1

    await expect(guard.beforeWrite()).rejects.toThrow('capacity_recovery_goal_composer_unverified')
    expect(now).toBeGreaterThanOrEqual(8_000)
  })

  it.each(['input', 'generation'] as const)(
    'cancels the Enter wait if %s changes during a screen read',
    async (change) => {
      let sequence = 10
      let generation = 3
      const guard = makeGuard({
        getInputSequence: () => sequence,
        getGeneration: () => generation,
        readScreen: () => {
          if (change === 'input') {
            sequence += 1
          } else {
            generation += 1
          }
          return readDraft('/goal resume')
        }
      })
      guard.recordReservation()
      sequence += 1

      await expect(guard.beforeWrite()).rejects.toThrow('capacity_recovery_')
    }
  )

  it('submits Continue only after the exact Continue draft renders', async () => {
    let now = 0
    let reads = 0
    let sequence = 10
    const guard = makeGuard({
      expectedCommand: 'Continue',
      now: () => now,
      getInputSequence: () => sequence,
      readScreen: () => (++reads < 3 ? readDraft('Conti') : readDraft('Continue')),
      wait: async (ms) => {
        now += ms
      }
    })

    await guard.beforeWrite()
    expect(reads).toBe(0)
    guard.recordReservation()
    sequence += 1
    await expect(guard.beforeWrite()).resolves.toBeUndefined()
    expect(reads).toBe(3)
  })

  it('never accepts a different draft for Continue, so a timed-out Continue writes no Enter', async () => {
    let now = 0
    let sequence = 10
    const guard = makeGuard({
      expectedCommand: 'Continue',
      now: () => now,
      getInputSequence: () => sequence,
      readScreen: () => readDraft('/goal resume'),
      wait: async (ms) => {
        now += ms
      }
    })
    guard.recordReservation()
    sequence += 1

    await expect(guard.beforeWrite()).rejects.toThrow('capacity_recovery_goal_composer_unverified')
    expect(now).toBeGreaterThanOrEqual(8_000)
  })
})
