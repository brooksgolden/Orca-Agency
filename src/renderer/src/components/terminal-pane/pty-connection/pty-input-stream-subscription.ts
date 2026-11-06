import { subscribeToTerminalInputData } from '../terminal-user-input-signal'
import {
  countTerminalInputTextCodeUnits,
  createTerminalInputStreamProbe
} from '../terminal-input-stream-probe'
import type { ConnectPanePtySession } from './connect-pane-pty-session'

/** Bind xterm input once, preserving user-input provenance through deferred forwarding. */
export function installPtyInputStreamSubscription(session: ConnectPanePtySession): void {
  const forwardUserInput = (data: string): void => session.forwardPtyInput(data, true)
  const forwardUnclassifiedInput = (data: string): void => session.forwardPtyInput(data, false)
  const inputStreamProbe = createTerminalInputStreamProbe()
  session.onDataDisposable = subscribeToTerminalInputData(
    session.pane.terminal,
    (data, wasUserInput) => {
      const forwardStartedAt = wasUserInput ? performance.now() : 0
      const forward = wasUserInput ? forwardUserInput : forwardUnclassifiedInput
      if (session.deps.deferPtyInput) {
        session.deps.deferPtyInput(session.pane.id, data, forward)
      } else {
        forward(data)
      }
      const inputCodeUnits = wasUserInput ? countTerminalInputTextCodeUnits(data) : 0
      if (inputCodeUnits > 0) {
        inputStreamProbe.observe(
          inputCodeUnits,
          performance.now() - forwardStartedAt,
          Boolean(session.deps.deferPtyInput)
        )
      }
    }
  )
}
