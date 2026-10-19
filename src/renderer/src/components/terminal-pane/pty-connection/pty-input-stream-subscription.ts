import { subscribeToTerminalInputData } from '../terminal-user-input-signal'
import { createTerminalInputStreamProbe } from '../terminal-input-stream-probe'
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
      // Arrow, mouse, and terminal control sequences are not dictated text.
      if (wasUserInput && data.charCodeAt(0) !== 0x1b) {
        inputStreamProbe.observe(data.length, performance.now() - forwardStartedAt)
      }
    }
  )
}
