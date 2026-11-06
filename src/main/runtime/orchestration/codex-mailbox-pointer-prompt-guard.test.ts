import { describe, expect, it, vi } from 'vitest'
import {
  createCodexMailboxPointerPromptGuard,
  createRuntimeCodexMailboxPointerPromptDeliveryHooks
} from './codex-mailbox-pointer-prompt-guard'
import type { OrchestrationMailboxPointerSubmitTarget } from './mailbox-pointer-submit'
import { OrchestrationDb } from './db'

const target = {
  terminal: {
    ptyId: 'pty-1',
    handle: 'term-1',
    paneKeys: ['tab-1:leaf-1'],
    lastAgentStatus: 'idle' as const,
    lastAgentStatusObservedLive: true
  },
  processIncarnation: 'inc-1'
}

function screen(draft?: string) {
  return {
    handle: 'term-1',
    status: 'running' as const,
    source: 'screen' as const,
    tail: [],
    truncated: false,
    nextCursor: null,
    composerState: draft === undefined ? ('empty' as const) : ('draft' as const),
    ...(draft === undefined ? {} : { draft })
  }
}

function makeGuard(input: {
  screen: () => ReturnType<typeof screen>
  sequence: () => number
  resolveTarget?: () => OrchestrationMailboxPointerSubmitTarget | null
}) {
  return createCodexMailboxPointerPromptGuard({
    getGeneration: () => 3,
    readInputSequence: input.sequence,
    resolveTarget: input.resolveTarget ?? (() => target),
    resolveMailbox: () => 'run:run-1',
    getPendingIds: () => new Set(['message-1']),
    readScreen: async () => input.screen(),
    wait: async () => undefined
  })(target, 'run:run-1', [{ id: 'message-1', type: 'review', sequence: 1 }], 'owned notice')
}

describe('Codex mailbox pointer prompt guard', () => {
  it('requires an empty composer before paste and the exact owned draft before submit', async () => {
    let sequence = 4
    let currentScreen = screen()
    const guard = makeGuard({ screen: () => currentScreen, sequence: () => sequence })
    await guard.beforeWrite('before_paste')
    guard.reserveWrite()
    sequence += 1
    currentScreen = screen('owned notice')
    await guard.beforeWrite('before_submit')
    expect(() => guard.reserveWrite()).not.toThrow()
  })

  it('refuses an existing draft before paste', async () => {
    const currentScreen = screen('human draft')
    const guard = makeGuard({ screen: () => currentScreen, sequence: () => 4 })
    await expect(guard.beforeWrite('before_paste')).rejects.toThrow('agent_prompt_stalled')
  })

  it('refuses human input between the owned paste and submit', async () => {
    let sequence = 4
    let currentScreen = screen()
    const guard = makeGuard({ screen: () => currentScreen, sequence: () => sequence })
    await guard.beforeWrite('before_paste')
    guard.reserveWrite()
    sequence += 2
    currentScreen = screen('owned notice')
    await expect(guard.beforeWrite('before_submit')).rejects.toThrow('agent_prompt_stalled')
  })

  it('rejects human input arriving after async preflight and before synchronous write reservation', async () => {
    let sequence = 4
    const guard = makeGuard({ screen: () => screen(), sequence: () => sequence })
    await guard.beforeWrite('before_paste')
    sequence += 1

    expect(() => guard.reserveWrite()).toThrow('agent_prompt_stalled')
  })

  it.each([
    ['missing terminal', null],
    ['replacement PTY', { ...target, terminal: { ...target.terminal, ptyId: 'pty-2' } }],
    ['replacement handle', { ...target, terminal: { ...target.terminal, handle: 'term-2' } }],
    ['replacement process', { ...target, processIncarnation: 'inc-2' }]
  ])('refuses a %s between preflight and the write reservation', async (_reason, current) => {
    let currentTarget: OrchestrationMailboxPointerSubmitTarget | null = target
    const guard = makeGuard({
      screen: () => screen(),
      sequence: () => 4,
      resolveTarget: () => currentTarget
    })
    await guard.beforeWrite('before_paste')
    currentTarget = current

    expect(() => guard.reserveWrite()).toThrow('agent_prompt_stalled')
  })

  it('uses the terminal ports for guarded runtime prompt delivery', async () => {
    const db = new OrchestrationDb(':memory:')
    const sendTerminalAgentPrompt = vi.fn(async (handle: string) => ({
      handle,
      accepted: true,
      bytesWritten: 12
    }))
    const resolveTarget = vi.fn(() => target)
    const resolveMailbox = vi.fn(() => 'run:run-1')
    const readTerminal = vi.fn(async () => screen())
    const hooks = createRuntimeCodexMailboxPointerPromptDeliveryHooks({
      getAgent: () => 'codex',
      sendTerminalAgentPrompt,
      getPtyLifecycleGeneration: () => 3,
      readInputSequence: () => 4,
      resolveOrchestrationPointerSubmitTarget: resolveTarget,
      resolveMailbox,
      getDb: () => db,
      readTerminal
    })
    try {
      const guard = hooks.createPointerPromptWriteGuard(target, 'run:run-1', [], 'owned notice')
      const beforeWrite = vi.fn(async () => undefined)
      const reserveWrite = vi.fn()

      expect(hooks.supportsPromptDelivery('pty-1')).toBe(true)
      await guard.beforeWrite('before_paste')
      guard.reserveWrite()
      await hooks.sendPointerPrompt(target, 'owned notice', beforeWrite, reserveWrite)

      expect(resolveTarget).toHaveBeenCalledWith('pty-1')
      expect(resolveMailbox).toHaveBeenCalledWith(target.terminal)
      expect(readTerminal).toHaveBeenCalledWith('term-1', { screen: true, limit: 80 })
      expect(sendTerminalAgentPrompt).toHaveBeenCalledWith(
        'term-1',
        'owned notice',
        expect.objectContaining({
          inputKind: 'driving',
          acceptQueued: true,
          observationTimeoutMs: 0,
          beforeWrite,
          reserveWrite
        })
      )
    } finally {
      db.close()
    }
  })
})
