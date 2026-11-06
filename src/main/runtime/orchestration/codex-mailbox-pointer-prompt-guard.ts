import type { RuntimeTerminalRead } from '../../../shared/runtime-terminal-read'
import { matchesCodexComposerDraft } from '../codex-busy-queue-prompt'
import type { OrchestrationMailboxPointerMessage } from './mailbox-pointer-delivery-contract'
import type { OrchestrationMailboxPointerSubmitTarget } from './mailbox-pointer-submit'
import type { OrchestrationDb } from './db'
import type { RuntimeAgentPromptWriteOptions } from '../runtime-terminal-contracts'
import type { RuntimeTerminalSend } from '../../../shared/runtime-types'
import type { OrchestrationMailboxTerminal } from './mailbox-owner'

type PromptWriteFence = { generation: number; inputSequence: number; writes: number }

export type CodexMailboxPointerPromptGuardDependencies = {
  getGeneration: (ptyId: string) => number
  readInputSequence: (ptyId: string) => number
  resolveTarget: (
    target: OrchestrationMailboxPointerSubmitTarget,
    ptyId: string
  ) => OrchestrationMailboxPointerSubmitTarget | null
  resolveMailbox: (target: OrchestrationMailboxPointerSubmitTarget) => string | null
  getPendingIds: (mailboxHandle: string) => ReadonlySet<string> | null
  readScreen: (handle: string) => Promise<RuntimeTerminalRead>
  wait: (ms: number) => Promise<void>
}

export type CodexMailboxPointerPromptDeliveryHooks = {
  getAgent: (ptyId: string) => string | null | undefined
  sendPointerPrompt: (
    target: OrchestrationMailboxPointerSubmitTarget,
    prompt: string,
    beforeWrite: () => Promise<void>,
    reserveWrite: () => void
  ) => Promise<{ accepted: boolean }>
} & CodexMailboxPointerPromptGuardDependencies

export type CodexMailboxPointerPromptWriteGuard = {
  beforeWrite: (phase: 'before_paste' | 'before_submit') => Promise<void>
  reserveWrite: () => void
}

type RuntimePointerPromptBridge = {
  getAgent: (ptyId: string) => string | null | undefined
  sendTerminalAgentPrompt: (
    handle: string,
    prompt: string,
    options: RuntimeAgentPromptWriteOptions
  ) => Promise<RuntimeTerminalSend>
  getPtyLifecycleGeneration: (ptyId: string) => number
  readInputSequence: (ptyId: string) => number
  resolveOrchestrationPointerSubmitTarget: (
    ptyId: string
  ) => OrchestrationMailboxPointerSubmitTarget | null
  resolveMailbox: (terminal: OrchestrationMailboxTerminal) => string | null | undefined
  getDb: () => OrchestrationDb | null
  readTerminal: (
    handle: string,
    options: { screen: true; limit: number }
  ) => Promise<RuntimeTerminalRead>
}

export function createCodexMailboxPointerPromptDeliveryHooks(
  deps: CodexMailboxPointerPromptDeliveryHooks
): {
  supportsPromptDelivery: (ptyId: string) => boolean
  sendPointerPrompt: CodexMailboxPointerPromptDeliveryHooks['sendPointerPrompt']
  createPointerPromptWriteGuard: ReturnType<typeof createCodexMailboxPointerPromptGuard>
} {
  return {
    supportsPromptDelivery: (ptyId) => deps.getAgent(ptyId) === 'codex',
    sendPointerPrompt: deps.sendPointerPrompt,
    createPointerPromptWriteGuard: createCodexMailboxPointerPromptGuard(deps)
  }
}

export function createRuntimeCodexMailboxPointerPromptDeliveryHooks(
  runtime: RuntimePointerPromptBridge
): ReturnType<typeof createCodexMailboxPointerPromptDeliveryHooks> {
  return createCodexMailboxPointerPromptDeliveryHooks({
    getAgent: runtime.getAgent,
    sendPointerPrompt: (target, prompt, beforeWrite, reserveWrite) =>
      runtime.sendTerminalAgentPrompt(target.terminal.handle, prompt, {
        inputKind: 'driving',
        acceptQueued: true,
        requestId: `mailbox-pointer:${target.processIncarnation}:${Date.now()}`,
        observationTimeoutMs: 0,
        beforeWrite,
        reserveWrite
      }),
    getGeneration: (ptyId) => runtime.getPtyLifecycleGeneration(ptyId),
    readInputSequence: (ptyId) => runtime.readInputSequence(ptyId),
    resolveTarget: (_target, ptyId) => runtime.resolveOrchestrationPointerSubmitTarget(ptyId),
    resolveMailbox: (target) => runtime.resolveMailbox(target.terminal) ?? null,
    getPendingIds: (mailboxHandle) => {
      const pending = runtime.getDb()?.getPendingMailboxPointerMessages(mailboxHandle)
      return pending ? new Set(pending.map((message) => message.id)) : null
    },
    readScreen: (handle) => runtime.readTerminal(handle, { screen: true, limit: 80 }),
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  })
}

export function createCodexMailboxPointerPromptGuard(
  deps: CodexMailboxPointerPromptGuardDependencies
): (
  target: OrchestrationMailboxPointerSubmitTarget,
  mailboxHandle: string,
  messages: readonly OrchestrationMailboxPointerMessage[],
  prompt: string
) => CodexMailboxPointerPromptWriteGuard {
  return (target, mailboxHandle, messages, prompt) => {
    const ptyId = target.terminal.ptyId
    if (!ptyId) {
      throw new Error('agent_prompt_stalled')
    }
    const fence: PromptWriteFence = {
      generation: deps.getGeneration(ptyId),
      inputSequence: deps.readInputSequence(ptyId),
      writes: 0
    }
    const assertTargetFence = (expectedInputSequence: number): void => {
      const current = deps.resolveTarget(target, ptyId)
      if (
        current?.terminal.ptyId !== ptyId ||
        current.terminal.handle !== target.terminal.handle ||
        current.processIncarnation !== target.processIncarnation ||
        deps.getGeneration(ptyId) !== fence.generation ||
        deps.readInputSequence(ptyId) !== expectedInputSequence ||
        deps.resolveMailbox(current) !== mailboxHandle
      ) {
        throw new Error('agent_prompt_stalled')
      }
    }

    return {
      beforeWrite: async (phase): Promise<void> => {
        const expectedPhase = fence.writes === 0 ? 'before_paste' : 'before_submit'
        if (phase !== expectedPhase || fence.writes > 1) {
          throw new Error('agent_prompt_stalled')
        }
        assertTargetFence(fence.inputSequence + fence.writes)
        if (fence.writes === 0) {
          const pending = deps.getPendingIds(mailboxHandle)
          if (!pending || messages.some((message) => !pending.has(message.id))) {
            throw new Error('agent_prompt_stalled')
          }
        }
        const deadline = Date.now() + 5_000
        let screen = await deps.readScreen(target.terminal.handle)
        while (
          fence.writes === 1 &&
          !matchesCodexComposerDraft(screen, prompt) &&
          Date.now() < deadline
        ) {
          assertTargetFence(fence.inputSequence + fence.writes)
          await deps.wait(50)
          screen = await deps.readScreen(target.terminal.handle)
        }
        assertTargetFence(fence.inputSequence + fence.writes)
        const composerMatches =
          screen.source === 'screen' &&
          (fence.writes === 0
            ? screen.composerState === 'empty'
            : matchesCodexComposerDraft(screen, prompt))
        if (!composerMatches) {
          throw new Error('agent_prompt_stalled')
        }
        fence.writes += 1
      },
      reserveWrite: (): void => {
        if (fence.writes < 1 || fence.writes > 2) {
          throw new Error('agent_prompt_stalled')
        }
        assertTargetFence(fence.inputSequence + fence.writes - 1)
        if (fence.writes === 1) {
          const pending = deps.getPendingIds(mailboxHandle)
          if (!pending || messages.some((message) => !pending.has(message.id))) {
            throw new Error('agent_prompt_stalled')
          }
        }
      }
    }
  }
}
