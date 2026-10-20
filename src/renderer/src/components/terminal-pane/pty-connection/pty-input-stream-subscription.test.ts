import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { subscribeToTerminalInputData } from '../terminal-user-input-signal'
import { installPtyInputStreamSubscription } from './pty-input-stream-subscription'
import type { ConnectPanePtySession } from './connect-pane-pty-session'

const recordBreadcrumb = vi.hoisted(() => vi.fn())
vi.mock('../terminal-user-input-signal', () => ({
  subscribeToTerminalInputData: vi.fn(() => ({ dispose: vi.fn() }))
}))
vi.mock('@/lib/crash-breadcrumb-recorder', () => ({
  recordRendererCrashBreadcrumb: recordBreadcrumb
}))
vi.mock('@/lib/pane-manager/pane-terminal-output-queue-registry', () => ({
  getTerminalOutputQueuePressure: () => ({ queuedTerminalCount: 0, queuedChars: 0 })
}))

function createSession(
  deferPtyInput?: ConnectPanePtySession['deps']['deferPtyInput']
): ConnectPanePtySession {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The installer accesses only these mocked session members.
  return {
    pane: { id: 1, terminal: {} },
    deps: { deferPtyInput },
    forwardPtyInput: vi.fn()
  } as unknown as ConnectPanePtySession
}

function inputListener(): (data: string, wasUserInput: boolean) => void {
  const listener = vi.mocked(subscribeToTerminalInputData).mock.calls.at(-1)?.[1]
  if (!listener) {
    throw new Error('input listener was not installed')
  }
  return listener
}

describe('PTY input stream subscription diagnostics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('document', { querySelectorAll: () => [1] })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('forwards before recording a content-free bracketed bulk input', () => {
    const session = createSession()
    installPtyInputStreamSubscription(session)
    const data = `\x1b[200~${'x'.repeat(300)}\x1b[201~`
    inputListener()(data, true)
    expect(session.forwardPtyInput).toHaveBeenCalledWith(data, true)
    expect(recordBreadcrumb).toHaveBeenCalledWith(
      'terminal_input_bulk',
      expect.objectContaining({ codeUnitsRoundedUp64: 320, deferred: false })
    )
    expect(JSON.stringify(recordBreadcrumb.mock.calls)).not.toContain('x'.repeat(30))
  })

  it('skips synthetic replies and control keys while preserving forwarding', () => {
    const session = createSession()
    installPtyInputStreamSubscription(session)
    inputListener()('x'.repeat(300), false)
    inputListener()('\x1b[A', true)
    expect(session.forwardPtyInput).toHaveBeenNthCalledWith(1, 'x'.repeat(300), false)
    expect(session.forwardPtyInput).toHaveBeenNthCalledWith(2, '\x1b[A', true)
    expect(recordBreadcrumb).not.toHaveBeenCalled()
  })

  it('labels deferred input without claiming it reached the PTY', () => {
    const deferPtyInput = vi.fn()
    const session = createSession(deferPtyInput)
    installPtyInputStreamSubscription(session)
    inputListener()('x'.repeat(300), true)
    expect(session.forwardPtyInput).not.toHaveBeenCalled()
    expect(recordBreadcrumb).toHaveBeenCalledWith(
      'terminal_input_bulk',
      expect.objectContaining({ deferred: true })
    )
  })
})
