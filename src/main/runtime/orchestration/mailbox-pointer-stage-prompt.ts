import type {
  OrchestrationMailboxPointerMessage,
  PointerDeliveryDependencies
} from './mailbox-pointer-delivery-contract'
import type {
  OrchestrationMailboxDeliveryFlight,
  OrchestrationMailboxPointerState
} from './mailbox-pointer-state'
import type { OrchestrationMessageWaiter } from './mailbox-pointer-eligibility'
import type { OrchestrationMailboxPointerSubmitTarget } from './mailbox-pointer-submit'
import {
  MAILBOX_POINTER_ENTER_ATTEMPTED,
  MAILBOX_POINTER_WRITE_ATTEMPTED
} from './db/messages/mailbox-pointer-enter-state'

type StagePromptPointerArgs<TWaiter extends OrchestrationMessageWaiter> = {
  deps: PointerDeliveryDependencies<TWaiter>
  state: OrchestrationMailboxPointerState
  mailboxHandle: string
  messages: readonly OrchestrationMailboxPointerMessage[]
  newestSequence: number
  ptyId: string
  flight: OrchestrationMailboxDeliveryFlight
  expectedTarget: OrchestrationMailboxPointerSubmitTarget
  prompt: string
  settle: (ptyId: string, flight: OrchestrationMailboxDeliveryFlight) => void
  redrive: (mailboxHandle: string, force?: boolean) => void
}

export function stageOrchestrationMailboxPointerPrompt<TWaiter extends OrchestrationMessageWaiter>(
  args: StagePromptPointerArgs<TWaiter>
): void {
  const { deps, state, ptyId, flight, mailboxHandle, newestSequence } = args
  const ids = args.messages.map((message) => message.id)
  let successfulGuards = 0
  let guard:
    | ReturnType<NonNullable<PointerDeliveryDependencies<TWaiter>['createPointerPromptWriteGuard']>>
    | undefined
  try {
    guard = deps.createPointerPromptWriteGuard?.(
      args.expectedTarget,
      mailboxHandle,
      args.messages,
      args.prompt
    )
  } catch {
    releaseBeforePaste()
    return
  }
  const beforeWrite = async (): Promise<void> => {
    const phase = successfulGuards === 0 ? 'before_paste' : 'before_submit'
    if (successfulGuards > 1 || !guard) {
      throw new Error('agent_prompt_stalled')
    }
    await guard.beforeWrite(phase)
    if (phase === 'before_submit') {
      // The guarded API owns the submit key. Advance the durable phase before it writes that key.
      // A concurrent read may make this transition return false; the already pasted notice still
      // completes once the process and input fences prove it is safe to submit.
      deps.getDb()?.markMailboxPointerEnterAttempted(ids, {
        ptyId,
        processIncarnation: args.expectedTarget.processIncarnation
      })
    }
    successfulGuards += 1
  }
  const reserveWrite = (): void => {
    guard?.reserveWrite()
  }

  void deps
    .sendPointerPrompt?.(args.expectedTarget, args.prompt, beforeWrite, reserveWrite)
    .then((result) => {
      if (!result.accepted || !state.isCurrentFlight(ptyId, flight)) {
        preserveAmbiguousPrompt()
        return
      }
      deps
        .getDb()
        ?.settleMailboxPointerEnter(
          ids,
          { ptyId, processIncarnation: args.expectedTarget.processIncarnation },
          [MAILBOX_POINTER_WRITE_ATTEMPTED, MAILBOX_POINTER_ENTER_ATTEMPTED]
        )
      state.clearWatermark(mailboxHandle, newestSequence, ptyId)
      args.settle(ptyId, flight)
      args.redrive(mailboxHandle)
    })
    .catch(() => {
      if (successfulGuards === 0 && state.isCurrentFlight(ptyId, flight)) {
        releaseBeforePaste()
        return
      }
      preserveAmbiguousPrompt()
    })

  function preserveAmbiguousPrompt(): void {
    if (!state.isCurrentFlight(ptyId, flight)) {
      return
    }
    state.deactivateWatermark(mailboxHandle, newestSequence, ptyId)
    args.settle(ptyId, flight)
  }

  function releaseBeforePaste(): void {
    try {
      deps
        .getDb()
        ?.releaseMailboxPointerEnter(
          ids,
          { ptyId, processIncarnation: args.expectedTarget.processIncarnation },
          [MAILBOX_POINTER_WRITE_ATTEMPTED]
        )
    } catch {
      // A failed preflight wrote no terminal bytes; startup recovery can still inspect the phase.
    }
    state.clearWatermark(mailboxHandle, newestSequence, ptyId)
    args.settle(ptyId, flight)
  }
}
