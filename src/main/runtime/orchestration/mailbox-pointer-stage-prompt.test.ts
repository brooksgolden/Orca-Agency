import { describe, expect, it, vi } from 'vitest'
import { OrchestrationDb } from './db'
import { OrchestrationMailboxPointerDelivery } from './mailbox-pointer-delivery'
import { OrchestrationMailboxPointerState } from './mailbox-pointer-state'
import { stageOrchestrationMailboxPointerPrompt } from './mailbox-pointer-stage-prompt'
import { MAILBOX_POINTER_WRITE_ATTEMPTED } from './db/messages/mailbox-pointer-enter-state'

const terminal = {
  ptyId: 'pty-1',
  handle: 'term-1',
  paneKeys: ['tab-1:leaf-1'],
  lastAgentStatus: 'idle' as const,
  lastAgentStatusObservedLive: true
}

describe('Codex mailbox pointer prompt staging', () => {
  it.each([false, true])(
    'submits the whole pointer through the guarded prompt API without a raw follow-up Enter (held delivery: %s)',
    async (holdDelivery) => {
      const db = new OrchestrationDb(':memory:')
      try {
        const run = db.createRun({
          objective: 'Guarded prompt delivery',
          coordinatorHandle: terminal.handle,
          coordinatorPaneKey: terminal.paneKeys[0]
        })
        const mailboxHandle = `run:${run.id}`
        if (holdDelivery) {
          db.insertMessage({ runId: run.id, from: 'worker', to: mailboxHandle, subject: 'held' })
        }
        const heldDelivery = holdDelivery
          ? db.getOrCreateMailboxDelivery({
              runId: run.id,
              mailboxHandle,
              consumerGeneration: run.consumer_generation
            })?.delivery
          : undefined
        const message = db.insertMessage({
          runId: run.id,
          from: 'worker',
          to: mailboxHandle,
          subject: 'notice'
        })
        const writePty = vi.fn()
        const guards: string[] = []
        const promptCalls = vi.fn(
          async (
            _target: unknown,
            prompt: string,
            beforeWrite: () => Promise<void>,
            reserveWrite: () => void
          ) => {
            await beforeWrite()
            reserveWrite()
            await beforeWrite()
            reserveWrite()
            return { accepted: prompt.includes(`orca orchestration check --run ${run.id}`) }
          }
        )
        const target = { terminal, processIncarnation: 'inc-1' }
        const delivery = new OrchestrationMailboxPointerDelivery({
          mailboxOwner: { resolve: () => mailboxHandle },
          deliveryTarget: { resolveTerminal: () => terminal, deferForAbsenceProbe: () => false },
          getDb: () => db,
          getTerminal: () => terminal,
          isAgentSettledForDelivery: () => true,
          getMessageWaiters: () => undefined,
          getCliCommand: () => 'orca',
          resolveSubmitTarget: () => target,
          isLeafPtyProvenAbsent: async () => false,
          isPtyAwaitingUserInput: () => false,
          redriveMailbox: vi.fn(),
          writePty,
          supportsPromptDelivery: () => true,
          sendPointerPrompt: promptCalls,
          createPointerPromptWriteGuard: () => ({
            beforeWrite: async (phase) => {
              guards.push(phase)
            },
            reserveWrite: vi.fn()
          })
          // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: This isolated delivery fixture supplies only the mailbox ports exercised here.
        } as never)

        delivery.deliver(terminal, { mailboxHandle, skipAbsenceProbe: true })
        await vi.waitFor(() => expect(db.getMessageById(message.id)?.delivered_at).not.toBeNull())

        expect(promptCalls).toHaveBeenCalledOnce()
        expect(guards).toEqual(['before_paste', 'before_submit'])
        expect(writePty).not.toHaveBeenCalled()
        expect(db.getMessageById(message.id)?.pointer_enter_pending).toBe(0)
        expect(db.getMessageById(message.id)?.delivered_at).not.toBeNull()
        if (holdDelivery) {
          expect(heldDelivery).toBeDefined()
          expect(promptCalls.mock.calls[0]?.[1]).toContain(`--ack ${heldDelivery?.id}`)
        }
      } finally {
        db.close()
      }
    }
  )

  it('does not immediately redrive after a pre-paste screen refusal', async () => {
    const state = new OrchestrationMailboxPointerState()
    const flight = state.beginFlight('pty-1')
    const redrive = vi.fn()
    const settle = vi.fn(() => state.settleFlight('pty-1', flight))
    const releaseMailboxPointerEnter = vi.fn()
    const sendPointerPrompt = vi.fn(
      async (
        _target: unknown,
        _prompt: string,
        beforeWrite: () => Promise<void>,
        _reserveWrite: () => void
      ) => {
        await beforeWrite()
        return { accepted: true }
      }
    )
    const deps = {
      sendPointerPrompt,
      createPointerPromptWriteGuard: () => ({
        beforeWrite: async () => {
          throw new Error('agent_prompt_stalled')
        },
        reserveWrite: vi.fn()
      }),
      getDb: () => ({ releaseMailboxPointerEnter }),
      supportsPromptDelivery: () => true
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: This refusal fixture supplies only the staging ports used before any terminal write.
    } as never
    state.setWatermark('run:one', 1, 'pty-1')

    stageOrchestrationMailboxPointerPrompt({
      deps,
      state,
      mailboxHandle: 'run:one',
      messages: [{ id: 'message-1', type: 'notice', sequence: 1 }],
      newestSequence: 1,
      ptyId: 'pty-1',
      flight,
      expectedTarget: {
        terminal,
        processIncarnation: 'inc-1'
      },
      prompt: 'owned pointer notice',
      settle,
      redrive
    })

    await vi.waitFor(() => expect(settle).toHaveBeenCalledOnce())
    expect(sendPointerPrompt).toHaveBeenCalledOnce()
    expect(releaseMailboxPointerEnter).toHaveBeenCalledWith(
      ['message-1'],
      { ptyId: 'pty-1', processIncarnation: 'inc-1' },
      [MAILBOX_POINTER_WRITE_ATTEMPTED]
    )
    expect(redrive).not.toHaveBeenCalled()
    expect(state.hasActiveWatermark('run:one')).toBe(false)
  })

  it('preserves the attempted phase after a post-paste guard failure', async () => {
    const state = new OrchestrationMailboxPointerState()
    const flight = state.beginFlight('pty-1')
    const redrive = vi.fn()
    const settle = vi.fn(() => state.settleFlight('pty-1', flight))
    const releaseMailboxPointerEnter = vi.fn()
    const sendPointerPrompt = vi.fn(
      async (
        _target: unknown,
        _prompt: string,
        beforeWrite: () => Promise<void>,
        reserveWrite: () => void
      ) => {
        await beforeWrite()
        reserveWrite()
        await beforeWrite()
        reserveWrite()
        return { accepted: true }
      }
    )
    let guards = 0
    const deps = {
      sendPointerPrompt,
      createPointerPromptWriteGuard: () => ({
        beforeWrite: async () => {
          guards += 1
          if (guards === 2) {
            throw new Error('agent_prompt_stalled')
          }
        },
        reserveWrite: vi.fn()
      }),
      getDb: () => ({ releaseMailboxPointerEnter, markMailboxPointerEnterAttempted: vi.fn() })
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: This failure fixture supplies only the ports used by an ambiguous staged write.
    } as never
    state.setWatermark('run:one', 1, 'pty-1')

    stageOrchestrationMailboxPointerPrompt({
      deps,
      state,
      mailboxHandle: 'run:one',
      messages: [{ id: 'message-1', type: 'notice', sequence: 1 }],
      newestSequence: 1,
      ptyId: 'pty-1',
      flight,
      expectedTarget: {
        terminal,
        processIncarnation: 'inc-1'
      },
      prompt: 'owned pointer notice',
      settle,
      redrive
    })

    await vi.waitFor(() => expect(settle).toHaveBeenCalledOnce())
    expect(releaseMailboxPointerEnter).not.toHaveBeenCalled()
    expect(redrive).not.toHaveBeenCalled()
    expect(state.hasActiveWatermark('run:one')).toBe(false)
  })
})
