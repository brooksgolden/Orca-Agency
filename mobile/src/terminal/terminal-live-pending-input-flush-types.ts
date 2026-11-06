import type { RefObject } from 'react'
import type { TextInput } from 'react-native'
import type { TerminalLiveInputSender } from './terminal-live-input-sender'
import type { TerminalLiveInputFailure } from './terminal-live-pending-flush-state'

export type TerminalLivePendingInputFlushOptions<TTabType extends string> = {
  readonly activeHandleRef: RefObject<string | null>
  readonly activeSessionTabTypeRef: RefObject<TTabType | null>
  readonly framesLivePaste?: (handle: string) => boolean
  readonly onFieldSessionEnded?: (handle: string) => void
  readonly onSendFailure?: (failure: TerminalLiveInputFailure) => void
  readonly liveInputRef: RefObject<TextInput | null>
  readonly liveInputTerminalHandlesRef: RefObject<Set<string>>
  readonly sendLiveTerminalInputRef: RefObject<TerminalLiveInputSender>
  readonly setLiveInputCapture: (text: string) => void
}

export type TerminalLivePendingInputFlush = {
  readonly applyLiveInputMirror: (
    handle: string,
    fieldText: string,
    composing?: boolean,
    forceFramedPaste?: boolean
  ) => Promise<boolean>
  readonly clearPendingLiveInputCommit: () => void
  readonly endLiveInputSessionThenSend: TerminalLiveInputSender
  readonly flushPendingLiveInputText: (expectedHandle: string | null) => Promise<boolean>
  readonly heldLiveInputTextRef: RefObject<string>
  readonly liveInputComposingRef: RefObject<boolean | undefined>
  readonly pendingLiveInputHandleRef: RefObject<string | null>
  readonly queueLiveInputControl: TerminalLiveInputSender
  readonly sentLiveInputTextRef: RefObject<string>
  readonly waitForPendingLiveInputFlush: () => Promise<boolean>
}
