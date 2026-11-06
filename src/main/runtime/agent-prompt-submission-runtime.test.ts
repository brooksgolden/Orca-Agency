import { afterEach, describe, expect, it, vi } from 'vitest'
import { AGENT_PROMPT_BRACKETED_PASTE_END } from '../../shared/agent-prompt-injection'
import {
  AGENT_PROMPT_TEST_WORKTREE_PATH,
  createAgentPromptSubmissionRuntime
} from './agent-prompt-submission-runtime-test-fixture'
import { OrcaRuntimeService } from './orca-runtime'
import { TUI_IDLE_QUIESCENCE_MS } from './orca-runtime-postlude'
import { makeStore } from './runtime-rpc-worktree-store-fixtures'
import { settledWriteStub } from '../providers/settled-pty-write-stub'

const createPromptRuntime = createAgentPromptSubmissionRuntime

function busyCodexScreen(
  draft?: string,
  composerState: 'empty' | 'draft' | 'unknown' = 'empty',
  tail: string[] = ['tab to queue message']
) {
  return {
    handle: 'term-prompt',
    status: 'running' as const,
    source: 'screen' as const,
    tail,
    ...(draft === undefined ? {} : { draft }),
    composerState,
    truncated: false,
    nextCursor: null
  }
}

vi.mock('../git/worktree', () => ({
  listWorktrees: vi.fn().mockResolvedValue([
    {
      path: '/tmp/worktree-a',
      head: 'abc',
      branch: 'feature/prompt-verification',
      isBare: false,
      isMainWorktree: false
    }
  ]),
  listWorktreesStrict: vi.fn().mockResolvedValue([
    {
      path: '/tmp/worktree-a',
      head: 'abc',
      branch: 'feature/prompt-verification',
      isBare: false,
      isMainWorktree: false
    }
  ])
}))

describe('agent prompt submission runtime', () => {
  afterEach(() => vi.useRealTimers())

  it('reserves the PTY write after asynchronous preflight to fence intervening human input', async () => {
    const { runtime, handle, writes } = await createAgentPromptSubmissionRuntime(
      (runtime, data) => runtime.terminalRunFacts.recordInput('pty-prompt', 'driving', data),
      'codex'
    )
    const initialSequence = runtime.terminalRunFacts.readInputSequence('pty-prompt')
    const submission = runtime.sendTerminalAgentPrompt(handle, 'owned prompt', {
      inputKind: 'driving',
      beforeWrite: async () => {
        queueMicrotask(() => {
          runtime.terminalRunFacts.recordInput('pty-prompt', 'driving', 'human input')
        })
      },
      reserveWrite: () => {
        if (runtime.terminalRunFacts.readInputSequence('pty-prompt') !== initialSequence) {
          throw new Error('agent_prompt_stalled')
        }
      }
    })

    await expect(submission).rejects.toThrow('agent_prompt_stalled')
    expect(writes).toEqual([])
  })

  it('queues only its exact pasted draft in a busy Codex composer with the captured Tab hint', async () => {
    vi.useFakeTimers()
    const { runtime, handle, writes } = await createAgentPromptSubmissionRuntime(
      (runtime, data) => runtime.terminalRunFacts.recordInput('pty-prompt', 'driving', data),
      'codex'
    )
    runtime.onPtyData('pty-prompt', '\x1b]0;Codex working\x07', Date.now())
    const hidden = 'q'.repeat(1575)
    const prompt = `handoff-prefix:${hidden}:handoff-suffix`
    const foldedPrompt = `handoff-prefix:[Pasted Content ${Array.from(hidden).length} chars]:handoff-suffix`
    const read = vi.spyOn(runtime, 'readTerminal')
    read.mockResolvedValueOnce(busyCodexScreen(undefined, 'empty', ['Ask Codex to do anything']))
    read.mockResolvedValueOnce(busyCodexScreen(foldedPrompt, 'draft'))
    read.mockResolvedValueOnce(busyCodexScreen(foldedPrompt, 'draft'))

    const submission = runtime.sendTerminalAgentPrompt(handle, prompt, {
      inputKind: 'driving',
      acceptQueued: true,
      observationTimeoutMs: 0,
      requestId: 'dispatch-queue-1'
    })
    await vi.runAllTimersAsync()

    await expect(submission).resolves.toMatchObject({
      accepted: true,
      prompt: { stages: ['input_accepted'] }
    })
    expect(writes.filter((data) => data === '\t')).toHaveLength(1)
    expect(writes.filter((data) => data === '\r')).toHaveLength(0)
  })

  it('does not Tab when human input changes the fence after the owned draft appears', async () => {
    vi.useFakeTimers()
    const { runtime, handle, writes } = await createAgentPromptSubmissionRuntime(
      (runtime, data) => runtime.terminalRunFacts.recordInput('pty-prompt', 'driving', data),
      'codex'
    )
    runtime.onPtyData('pty-prompt', '\x1b]0;Codex working\x07', Date.now())
    const read = vi.spyOn(runtime, 'readTerminal')
    read.mockResolvedValueOnce(busyCodexScreen(undefined, 'empty', ['Ask Codex to do anything']))
    read.mockResolvedValueOnce(busyCodexScreen('handoff sentinel', 'draft'))
    read.mockResolvedValueOnce(busyCodexScreen('handoff sentinel', 'draft'))
    let beforeWriteCalls = 0
    const submission = runtime.sendTerminalAgentPrompt(handle, 'handoff sentinel', {
      inputKind: 'driving',
      acceptQueued: true,
      requestId: 'dispatch-queue-input-race',
      beforeWrite: () => {
        beforeWriteCalls += 1
        if (beforeWriteCalls === 2) {
          runtime.terminalRunFacts.recordInput('pty-prompt', 'driving', 'human keystroke')
        }
      }
    })
    const rejected = expect(submission).rejects.toThrow('agent_prompt_stalled')
    await vi.runAllTimersAsync()
    await rejected

    expect(writes.some((data) => data === '\t')).toBe(false)
  })

  it('preserves an existing busy-composer draft instead of pasting over it', async () => {
    vi.useFakeTimers()
    const { runtime, handle, writes } = await createAgentPromptSubmissionRuntime(
      (runtime, data) => runtime.terminalRunFacts.recordInput('pty-prompt', 'driving', data),
      'codex'
    )
    runtime.onPtyData('pty-prompt', '\x1b]0;Codex working\x07', Date.now())
    vi.spyOn(runtime, 'readTerminal').mockResolvedValue(busyCodexScreen('user draft', 'draft'))

    const submission = runtime.sendTerminalAgentPrompt(handle, 'handoff sentinel', {
      inputKind: 'driving',
      acceptQueued: true,
      requestId: 'dispatch-existing-draft'
    })
    const rejected = expect(submission).rejects.toThrow('agent_prompt_stalled')
    await vi.runAllTimersAsync()
    await rejected

    expect(writes).toEqual([])
  })

  it('submits once with Enter if the same busy turn finishes while its exact draft renders', async () => {
    vi.useFakeTimers()
    const { runtime, handle, writes } = await createAgentPromptSubmissionRuntime(
      (runtime, data) => {
        runtime.terminalRunFacts.recordInput('pty-prompt', 'driving', data)
        if (data.includes(AGENT_PROMPT_BRACKETED_PASTE_END)) {
          runtime.onPtyData('pty-prompt', '\x1b]0;Codex idle\x07', Date.now())
        }
      },
      'codex'
    )
    runtime.onPtyData('pty-prompt', '\x1b]0;Codex working\x07', Date.now())
    const prompt = 'handoff completed while pasting'
    const read = vi.spyOn(runtime, 'readTerminal')
    read.mockResolvedValueOnce(busyCodexScreen(undefined, 'empty', ['Ask Codex to do anything']))
    read.mockResolvedValueOnce(busyCodexScreen(prompt, 'draft', ['Press Enter to send']))
    read.mockResolvedValueOnce(busyCodexScreen(prompt, 'draft', ['Press Enter to send']))

    const submission = runtime.sendTerminalAgentPrompt(handle, prompt, {
      inputKind: 'driving',
      acceptQueued: true,
      observationTimeoutMs: 0,
      requestId: 'dispatch-queue-turn-finished'
    })
    await vi.runAllTimersAsync()

    await expect(submission).resolves.toMatchObject({
      accepted: true,
      prompt: { stages: ['input_accepted'] }
    })
    expect(writes.filter((data) => data === '\r')).toHaveLength(1)
    expect(writes.filter((data) => data === '\t')).toHaveLength(0)
  })

  it('does not submit a draft after a new turn replaces the original busy turn', async () => {
    vi.useFakeTimers()
    const { runtime, handle, writes } = await createAgentPromptSubmissionRuntime(
      (runtime, data) => {
        runtime.terminalRunFacts.recordInput('pty-prompt', 'driving', data)
        if (data.includes(AGENT_PROMPT_BRACKETED_PASTE_END)) {
          runtime.onPtyData('pty-prompt', '\x1b]0;Codex idle\x07', Date.now())
          runtime.onPtyData('pty-prompt', '\x1b]0;Codex working\x07', Date.now())
        }
      },
      'codex'
    )
    runtime.onPtyData('pty-prompt', '\x1b]0;Codex working\x07', Date.now())
    const read = vi.spyOn(runtime, 'readTerminal')
    read.mockResolvedValueOnce(busyCodexScreen(undefined, 'empty', ['Ask Codex to do anything']))
    read.mockResolvedValueOnce(busyCodexScreen('handoff sentinel', 'draft'))

    const submission = runtime.sendTerminalAgentPrompt(handle, 'handoff sentinel', {
      inputKind: 'driving',
      acceptQueued: true,
      requestId: 'dispatch-queue-new-turn'
    })
    const rejected = expect(submission).rejects.toThrow('agent_prompt_stalled')
    await vi.runAllTimersAsync()
    await rejected

    expect(writes.filter((data) => data === '\t' || data === '\r')).toHaveLength(0)
  })

  it('submits exactly once after an observed lifecycle transition', async () => {
    vi.useFakeTimers()
    const { runtime, handle, writes } = await createAgentPromptSubmissionRuntime(
      (runtime, data) => {
        if (data === '\r') {
          runtime.onPtyData('pty-prompt', '\x1b]0;Codex working\x07', Date.now())
        }
      }
    )

    const submission = runtime.sendTerminalAgentPrompt(handle, 'review this', {
      inputKind: 'driving'
    })
    await vi.runAllTimersAsync()

    await expect(submission).resolves.toMatchObject({ accepted: true })
    expect(writes.filter((data) => data === '\r')).toHaveLength(1)
  })

  it('accepts a working-to-idle cycle completed before the first poll', async () => {
    vi.useFakeTimers()
    const { runtime, handle, writes } = await createPromptRuntime((runtime, data) => {
      if (data === '\r') {
        runtime.onPtyData('pty-prompt', '\x1b]0;Codex working\x07', Date.now())
        runtime.onPtyData('pty-prompt', '\x1b]0;Codex idle\x07', Date.now())
      }
    })

    const submission = runtime.sendTerminalAgentPrompt(handle, 'review this', {
      inputKind: 'driving'
    })
    await vi.runAllTimersAsync()

    await expect(submission).resolves.toMatchObject({ accepted: true })
    expect(writes.filter((data) => data === '\r')).toHaveLength(1)
  })

  it('reports redraw-only activity as stalled without retrying Enter', async () => {
    vi.useFakeTimers()
    const { runtime, handle, writes } = await createPromptRuntime((runtime, data) => {
      if (data.includes(AGENT_PROMPT_BRACKETED_PASTE_END)) {
        runtime.onPtyData('pty-prompt', '\x1b[2J\x1b[H› review this', Date.now())
      } else if (data === '\r') {
        runtime.onPtyData('pty-prompt', '\x1b[2J\x1b[H› review this', Date.now())
      }
    })
    const submission = runtime.sendTerminalAgentPrompt(handle, 'review this', {
      inputKind: 'driving'
    })
    const rejected = expect(submission).rejects.toThrow('agent_prompt_stalled')

    await vi.runAllTimersAsync()

    await rejected
    expect(writes.filter((data) => data === '\r')).toHaveLength(1)
  })

  it('reports a neutral title transition as stalled without retrying Enter', async () => {
    vi.useFakeTimers()
    const { runtime, handle, writes } = await createPromptRuntime((runtime, data) => {
      if (data === '\r') {
        runtime.onPtyData('pty-prompt', '\x1b]0;plain shell\x07', Date.now())
        runtime.onPtyData('pty-prompt', '\x1b]0;Codex idle\x07', Date.now())
      }
    })
    runtime.onPtyData('pty-prompt', '\x1b]0;Codex idle\x07', Date.now())
    const submission = runtime.sendTerminalAgentPrompt(handle, 'review this', {
      inputKind: 'driving'
    })
    const rejected = expect(submission).rejects.toThrow('agent_prompt_stalled')

    await vi.runAllTimersAsync()

    await rejected
    expect(writes.filter((data) => data === '\r')).toHaveLength(1)
  })

  it('does not send Enter after a permission state appears', async () => {
    vi.useFakeTimers()
    const { runtime, handle, writes } = await createPromptRuntime((runtime, data) => {
      if (data.includes(AGENT_PROMPT_BRACKETED_PASTE_END)) {
        runtime.onPtyData('pty-prompt', '\x1b]0;Codex waiting for permission\x07', Date.now())
      }
    })
    const submission = runtime.sendTerminalAgentPrompt(handle, 'review this', {
      inputKind: 'driving'
    })
    const rejected = expect(submission).rejects.toThrow('agent_prompt_blocked')

    await vi.runAllTimersAsync()

    await rejected
    expect(writes).not.toContain('\r')
  })

  it('does not paste into an existing permission prompt', async () => {
    const { runtime, handle, writes } = await createPromptRuntime(() => undefined)
    runtime.onPtyData('pty-prompt', '\x1b]0;Codex waiting for permission\x07', Date.now())

    await expect(
      runtime.sendTerminalAgentPrompt(handle, 'review this', { inputKind: 'driving' })
    ).rejects.toThrow('agent_prompt_blocked')
    expect(writes).toEqual([])
  })

  it('does not paste into an output-only permission prompt', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const { runtime, handle, writes } = await createPromptRuntime(() => undefined)
    runtime.onPtyData('pty-prompt', '\x1b]0;Codex idle\x07', Date.now())
    vi.setSystemTime(2_000)
    runtime.onPtyData(
      'pty-prompt',
      'Permission required\nAllow once\nAllow always\nReject\n',
      Date.now()
    )

    await expect(
      runtime.sendTerminalAgentPrompt(handle, 'review this', { inputKind: 'driving' })
    ).rejects.toThrow('agent_prompt_blocked')
    expect(writes).toEqual([])
  })

  it('does not paste into a coalesced live permission title', async () => {
    const { runtime, handle, writes } = await createPromptRuntime(() => undefined)
    runtime.onPtyData(
      'pty-prompt',
      '\x1b]9999;{"state":"working","agentType":"aider"}\x07' +
        '\x1b]0;Codex waiting for permission\x07',
      Date.now()
    )

    await expect(
      runtime.sendTerminalAgentPrompt(handle, 'review this', { inputKind: 'driving' })
    ).rejects.toThrow('agent_prompt_blocked')
    expect(writes).toEqual([])
  })

  it('does not paste when split status stripping completes a permission title', async () => {
    vi.useFakeTimers()
    const { runtime, handle, writes } = await createPromptRuntime((runtime, data) => {
      if (data === '\r') {
        runtime.onPtyData('pty-prompt', '\x1b]0;Codex working\x07', Date.now())
      }
    })
    runtime.onPtyData(
      'pty-prompt',
      '\x1b]0;Codex waiting for permission\x1b]9999;{"state":"working","agentType":"aider"',
      Date.now()
    )
    runtime.onPtyData('pty-prompt', '}\x07\x07', Date.now())

    const submission = runtime.sendTerminalAgentPrompt(handle, 'review this', {
      inputKind: 'driving'
    })
    const rejected = expect(submission).rejects.toThrow('agent_prompt_blocked')
    await vi.runAllTimersAsync()

    await rejected
    expect(writes).toEqual([])
  })

  it('preserves hook permission after an earlier live idle title', async () => {
    const { runtime, handle, writes } = await createPromptRuntime(() => undefined)
    runtime.onPtyData(
      'pty-prompt',
      'Permission required\nAllow once\nAllow always\nReject\n',
      Date.now()
    )
    runtime.onPtyData('pty-prompt', '\x1b]0;Codex idle\x07', Date.now())
    runtime.onPtyData(
      'pty-prompt',
      '\x1b]9999;{"state":"waiting","agentType":"aider"}\x07',
      Date.now()
    )

    await expect(
      runtime.sendTerminalAgentPrompt(handle, 'review this', { inputKind: 'driving' })
    ).rejects.toThrow('agent_prompt_blocked')
    expect(writes).toEqual([])
  })

  // Why real timers until the send: the emulator drains on timers, and the screen may clear only once quiet.
  async function settleScreen(runtime: OrcaRuntimeService, handle: string): Promise<void> {
    const outputAt = Date.now()
    vi.useRealTimers()
    await runtime.readTerminal(handle, { screen: true })
    vi.useFakeTimers({ now: Math.max(outputAt, Date.now()) + TUI_IDLE_QUIESCENCE_MS })
  }

  it('sends to a ready Codex composer whose erased dialog the line tail still holds', async () => {
    const { runtime, handle, writes } = await createPromptRuntime((runtime, data) => {
      if (data.includes(AGENT_PROMPT_BRACKETED_PASTE_END)) {
        // Why the echo: it ends the quiet the screen clear needs before the pre-Enter check.
        runtime.onPtyData('pty-prompt', '\x1b[22;1H› review this', Date.now())
      } else if (data === '\r') {
        runtime.onPtyData('pty-prompt', '\x1b]0;Codex working\x07', Date.now())
      }
    }, 'codex')
    vi.spyOn(runtime, 'getTerminalSize').mockReturnValue({ cols: 80, rows: 24 })
    // Codex 0.154's exec approval, then its in-place repaint once approved (no OSC 7501, Stop hook failed).
    runtime.onPtyData(
      'pty-prompt',
      '\x1b[14;3HWould you like to run the following command?\x1b[16;3H$ touch made.txt' +
        '\x1b[18;1H› 1. Yes, proceed (y)\x1b[19;3H3. No, and tell Codex what to do differently (esc)' +
        '\x1b[21;3HPress enter to confirm or esc to cancel',
      Date.now()
    )
    await settleScreen(runtime, handle)
    await expect(
      runtime.sendTerminalAgentPrompt(handle, 'review this', { inputKind: 'driving' })
    ).rejects.toThrow('agent_prompt_blocked')

    runtime.onPtyData(
      'pty-prompt',
      '\x1b[12;1H\x1b[J• done\x1b[22;1H› Ask Codex to do anything',
      Date.now()
    )
    await settleScreen(runtime, handle)
    const submission = runtime.sendTerminalAgentPrompt(handle, 'review this', {
      inputKind: 'driving'
    })
    await vi.runAllTimersAsync()

    await expect(submission).resolves.toMatchObject({ accepted: true })
    expect(writes.filter((data) => data === '\r')).toHaveLength(1)
  })

  it('refuses a settled dialog taller than the live window, as OpenCode 2 paints its permission prompt', async () => {
    const { runtime, handle, writes } = await createPromptRuntime(() => undefined, 'opencode')
    vi.spyOn(runtime, 'getTerminalSize').mockReturnValue({ cols: 80, rows: 24 })
    // Why every row drawn: permission.tsx gives the dialog a ┃ left border and maxHeight 15.
    const rows = [
      '┃',
      '┃  △ Permission required',
      ...Array.from({ length: 11 }, (_, index) => `┃    $ ./step-${index}.sh`),
      '┃',
      '┃  Allow once  Reject                         ctrl+f fullscreen'
    ]
    runtime.onPtyData(
      'pty-prompt',
      rows.map((row, index) => `\x1b[${index + 8};1H${row}`).join(''),
      Date.now()
    )
    await settleScreen(runtime, handle)

    await expect(
      runtime.sendTerminalAgentPrompt(handle, 'review this', { inputKind: 'driving' })
    ).rejects.toThrow('agent_prompt_blocked')
    expect(writes).toEqual([])
  })

  it('does not block on permission text restored only as history', async () => {
    vi.useFakeTimers()
    const { runtime, handle, writes } = await createPromptRuntime((runtime, data) => {
      if (data === '\r') {
        runtime.onPtyData('pty-prompt', '\x1b]0;Codex working\x07', Date.now())
      }
    })
    runtime.seedTerminalRestoreTail('pty-prompt', {
      text: 'Permission required\r\nAllow once\r\nAllow always\r\nReject\r\n'
    })

    const submission = runtime.sendTerminalAgentPrompt(handle, 'review this', {
      inputKind: 'driving'
    })
    await vi.runAllTimersAsync()

    await expect(submission).resolves.toMatchObject({ accepted: true })
    expect(writes.filter((data) => data === '\r')).toHaveLength(1)
  })

  it('does not send Enter after output-only permission appears during settlement', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const { runtime, handle, writes } = await createPromptRuntime((runtime, data) => {
      if (data.includes(AGENT_PROMPT_BRACKETED_PASTE_END)) {
        vi.setSystemTime(2_000)
        runtime.onPtyData(
          'pty-prompt',
          'Permission required\nAllow once\nAllow always\nReject\n',
          Date.now()
        )
      }
    })
    runtime.onPtyData('pty-prompt', '\x1b]0;Codex idle\x07', Date.now())
    const submission = runtime.sendTerminalAgentPrompt(handle, 'review this', {
      inputKind: 'driving'
    })
    const rejected = expect(submission).rejects.toThrow('agent_prompt_blocked')

    await vi.runAllTimersAsync()

    await rejected
    expect(writes).not.toContain('\r')
  })

  it.each([
    '\x1b]0;Codex waiting for permission\x07\x1b]0;Codex idle\x07',
    '\x1b]9999;{"state":"working","agentType":"aider"}\x07' +
      '\x1b]0;Codex waiting for permission\x07',
    '\x1b]0;Codex waiting for permission\x07' +
      '\x1b]9999;{"state":"working","agentType":"aider"}\x07'
  ])('does not send Enter after coalesced permission activity', async (output) => {
    vi.useFakeTimers()
    const { runtime, handle, writes } = await createPromptRuntime((runtime, data) => {
      if (data.includes(AGENT_PROMPT_BRACKETED_PASTE_END)) {
        runtime.onPtyData('pty-prompt', output, Date.now())
      }
    })
    const submission = runtime.sendTerminalAgentPrompt(handle, 'review this', {
      inputKind: 'driving'
    })
    const rejected = expect(submission).rejects.toThrow('agent_prompt_blocked')

    await vi.runAllTimersAsync()

    await rejected
    expect(writes).not.toContain('\r')
  })

  it('does not submit an atomic paste after permission appears', async () => {
    const { runtime, handle, writes } = await createPromptRuntime(() => undefined)
    let writeChecks = 0

    const submission = runtime.sendTerminalAgentPrompt(handle, 'x'.repeat(20_000), {
      inputKind: 'driving',
      beforeWrite: () => {
        writeChecks += 1
        if (writeChecks === 2) {
          runtime.onPtyData('pty-prompt', '\x1b]0;Codex waiting for permission\x07', Date.now())
        }
      }
    })

    await expect(submission).rejects.toThrow('agent_prompt_blocked')
    expect(writes).toHaveLength(1)
    expect(writes[0]).toContain(AGENT_PROMPT_BRACKETED_PASTE_END)
    expect(writes).not.toContain('\r')
  })

  it('does not submit an atomic paste after transient output-only permission', async () => {
    const { runtime, handle, writes } = await createPromptRuntime(() => undefined)
    runtime.onPtyData('pty-prompt', 'initial output\n', Date.now())
    let writeChecks = 0

    const submission = runtime.sendTerminalAgentPrompt(handle, 'x'.repeat(20_000), {
      inputKind: 'driving',
      beforeWrite: () => {
        writeChecks += 1
        if (writeChecks === 2) {
          runtime.onPtyData(
            'pty-prompt',
            'Permission required\nAllow once\nAllow always\nReject\n',
            Date.now()
          )
          runtime.onPtyData('pty-prompt', '\x1b]0;Codex working\x07', Date.now())
        }
      }
    })

    await expect(submission).rejects.toThrow('agent_prompt_blocked')
    expect(writes).toHaveLength(1)
    expect(writes[0]).toContain(AGENT_PROMPT_BRACKETED_PASTE_END)
    expect(writes).not.toContain('\r')
  })

  it('prefers a later permission title over an earlier explicit idle status', async () => {
    const { runtime, handle, writes } = await createPromptRuntime(() => undefined)
    runtime.onPtyData(
      'pty-prompt',
      '\x1b]9999;{"state":"done","agentType":"aider"}\x07',
      Date.now()
    )
    runtime.onPtyData('pty-prompt', '\x1b]0;Codex waiting for permission\x07', Date.now())

    await expect(
      runtime.sendTerminalAgentPrompt(handle, 'review this', { inputKind: 'driving' })
    ).rejects.toThrow('agent_prompt_blocked')
    expect(writes).toEqual([])
  })

  it('prefers later explicit idle evidence over stale permission output', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    let handle = ''
    const writes: string[] = []
    const runtime = new OrcaRuntimeService(makeStore() as never, undefined, {
      getAgentStatusSnapshot: () => [
        {
          paneKey: 'prompt-pane',
          terminalHandle: handle,
          state: 'done',
          prompt: '',
          agentType: 'aider',
          connectionId: null,
          receivedAt: Date.now(),
          stateStartedAt: Date.now()
        }
      ]
    })
    runtime.setPtyController({
      spawn: vi.fn().mockResolvedValue({ id: 'pty-prompt' }),
      write: (_ptyId, data) => {
        writes.push(data)
        if (data === '\r') {
          runtime.onPtyData('pty-prompt', '\x1b]0;Codex working\x07', Date.now())
        }
        return true
      },
      kill: () => true,
      getForegroundProcess: async () => null
    })
    handle = (
      await runtime.createTerminal(`path:${AGENT_PROMPT_TEST_WORKTREE_PATH}`, {
        launchAgent: 'aider'
      })
    ).handle
    runtime.onPtyData(
      'pty-prompt',
      'Permission required\nAllow once\nAllow always\nReject\n' +
        '\x1b]0;Codex waiting for permission\x07',
      Date.now()
    )
    vi.setSystemTime(2_000)

    const submission = runtime.sendTerminalAgentPrompt(handle, 'review this', {
      inputKind: 'driving'
    })
    await vi.runAllTimersAsync()

    await expect(submission).resolves.toMatchObject({ accepted: true })
    expect(writes.filter((data) => data === '\r')).toHaveLength(1)
  })

  it('prefers a later working title over an earlier explicit idle status', async () => {
    vi.useFakeTimers()
    const { runtime, handle, writes } = await createPromptRuntime((runtime, data) => {
      if (data === '\r') {
        runtime.onPtyData('pty-prompt', '\x1b]0;Codex working\x07', Date.now())
      }
    })
    runtime.onPtyData(
      'pty-prompt',
      '\x1b]9999;{"state":"done","agentType":"aider"}\x07',
      Date.now()
    )

    const submission = runtime.sendTerminalAgentPrompt(handle, 'review this', {
      inputKind: 'driving'
    })
    await vi.runAllTimersAsync()

    await expect(submission).resolves.toMatchObject({ accepted: true })
    expect(writes.filter((data) => data === '\r')).toHaveLength(1)
  })

  it('does not treat an unchanged newer working status as submission evidence', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const { runtime, handle, writes } = await createPromptRuntime(() => undefined)
    runtime.onPtyData('pty-prompt', '\x1b]0;Codex waiting for permission\x07', Date.now())
    vi.setSystemTime(2_000)
    runtime.onPtyData(
      'pty-prompt',
      '\x1b]9999;{"state":"working","agentType":"aider"}\x07',
      Date.now()
    )

    const submission = runtime.sendTerminalAgentPrompt(handle, 'review this', {
      inputKind: 'driving'
    })
    const rejected = expect(submission).rejects.toThrow('agent_prompt_stalled')
    await vi.runAllTimersAsync()

    await rejected
    expect(writes.filter((data) => data === '\r')).toHaveLength(1)
  })

  // #16095: an already-working agent has no new working edge; post-Enter output supplies delivery evidence.
  it('accepts pane output after Enter while the agent is already working', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const { runtime, handle, writes } = await createPromptRuntime((runtime, data) => {
      if (data === '\r') {
        runtime.onPtyData('pty-prompt', 'queued for the current turn', Date.now())
      }
    })
    runtime.onPtyData(
      'pty-prompt',
      '\x1b]9999;{"state":"working","agentType":"aider"}\x07',
      Date.now()
    )

    const submission = runtime.sendTerminalAgentPrompt(handle, 'review this', {
      inputKind: 'driving'
    })
    await vi.runAllTimersAsync()

    await expect(submission).resolves.toMatchObject({ accepted: true })
    expect(writes.filter((data) => data === '\r')).toHaveLength(1)
  })

  it('keeps a queued receipt pending when only the existing turn emits output', async () => {
    vi.useFakeTimers()
    const { runtime, handle, writes } = await createAgentPromptSubmissionRuntime(
      (runtime, data) => {
        runtime.terminalRunFacts.recordInput('pty-prompt', 'driving', data)
        if (data === '\t') {
          runtime.onPtyData('pty-prompt', 'output from the existing turn', Date.now())
        }
      },
      'codex'
    )
    runtime.onPtyData('pty-prompt', '\x1b]0;Codex working\x07', Date.now())
    const read = vi.spyOn(runtime, 'readTerminal')
    read.mockResolvedValueOnce(busyCodexScreen())
    read.mockResolvedValueOnce(busyCodexScreen('review this', 'draft'))
    read.mockResolvedValueOnce(busyCodexScreen('review this', 'draft'))

    const submission = runtime.sendTerminalAgentPrompt(handle, 'review this', {
      inputKind: 'driving',
      acceptQueued: true,
      requestId: 'queued-output-only',
      observationTimeoutMs: 0
    })
    await vi.runAllTimersAsync()

    await expect(submission).resolves.toMatchObject({
      prompt: { stages: ['input_accepted'] }
    })
    expect(writes.filter((data) => data === '\t')).toHaveLength(1)
  })

  // Provider hooks reach headless/minimized runtimes without window or OSC-title evidence.
})

const PTY = 'pty-input-dispatch'
const HANDLE = 'term_input_dispatch'

function inputDispatchRuntime() {
  const result = new OrcaRuntimeService()
  const write = vi.fn(() => true)
  result.setPtyController({
    write,
    writeWithSettlement: settledWriteStub(write),
    kill: () => true,
    getForegroundProcess: async () => null
  })
  result.registerPty(PTY, 'repo::/tmp/input-dispatch', null, {
    tabId: '11111111-1111-4111-8111-111111111111',
    leafId: '22222222-2222-4222-8222-222222222222',
    incarnationId: 'input-dispatch-test'
  })
  result.registerPreAllocatedHandleForPty(PTY, HANDLE)
  return result
}

describe('agent prompt submission queue', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('serializes rejected submissions, isolates generations and keeps a replacement tail', async () => {
    const target = inputDispatchRuntime()
    const gate = Promise.withResolvers<void>()
    const calls: string[] = []
    const first = target['serializeAgentPromptSubmission'](PTY, 1, async () => {
      calls.push('first')
      await gate.promise
      throw new Error('rejected submission')
    })
    const rejected = expect(first).rejects.toThrow('rejected submission')
    const second = target['serializeAgentPromptSubmission'](PTY, 1, async () => {
      calls.push('second')
      return 2
    })
    const freshGeneration = target['serializeAgentPromptSubmission'](PTY, 2, async () => {
      calls.push('fresh')
      return 'fresh result'
    })
    await expect(freshGeneration).resolves.toBe('fresh result')
    expect(calls).toEqual(['first', 'fresh'])
    const replacement = Promise.resolve()
    const key = `${PTY}\u00001`
    target['agentPromptSubmissionTailByPtyId'].set(key, replacement)
    gate.resolve()
    await rejected
    await expect(second).resolves.toBe(2)
    expect(calls).toEqual(['first', 'fresh', 'second'])
    expect(target['agentPromptSubmissionTailByPtyId'].get(key)).toBe(replacement)
    expect(target['agentPromptSubmissionTailByPtyId'].has(`${PTY}\u00002`)).toBe(false)
  })
})
