import { afterEach, describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from './orca-runtime-test-mocks.spec'
import { store, TEST_WORKTREE_ID } from './orca-runtime-test-fixtures.spec'
import { WRITE_ACCEPTED } from '../../shared/pty-write-settlement'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isCodexCapacityScreen } from './codex-capacity-screen'
import { readCapacityRecoveryScreen } from './runtime-codex-capacity-recovery'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function runtimeWithCapacityRecovery(enabled: boolean) {
  const runtime = new OrcaRuntimeService({
    ...store,
    getSettings: () => ({ ...store.getSettings(), codexCapacityAutoContinue: enabled })
  })
  const writes: string[] = []
  runtime.setPtyController({
    spawn: async () => ({ id: 'pty-capacity', incarnationId: 'incarnation-1' }),
    write: () => true,
    writeWithSettlement: (id, data, kind) => {
      runtime.terminalRunFacts.recordInput(id, kind, data)
      writes.push(data)
      return WRITE_ACCEPTED
    },
    kill: () => true,
    getForegroundProcess: async () => 'codex'
  })
  runtime.registerPty('pty-capacity', TEST_WORKTREE_ID, null, {
    tabId: '11111111-1111-4111-8111-111111111111',
    leafId: '22222222-2222-4222-8222-222222222222',
    incarnationId: 'incarnation-1',
    providerReattachLaunchIdentity: { incarnationId: 'incarnation-1', launchAgent: 'codex' }
  })
  vi.spyOn(runtime, 'readLaunchedAgentForeground').mockResolvedValue('agent')
  const realRead = runtime.readTerminal.bind(runtime)
  const read = vi.spyOn(runtime, 'readTerminal').mockResolvedValue({
    handle: 'term-capacity-screen',
    status: 'running',
    source: 'screen',
    composerState: 'empty',
    tail: ['■ Selected model is at capacity. Please try a different model.'],
    truncated: false,
    nextCursor: null
  })
  vi.useFakeTimers()
  vi.spyOn(Math, 'random').mockReturnValue(0)
  const fail = () => {
    runtime.onPtyData('pty-capacity', '\x1b]0;Codex working\x07', Date.now())
    runtime.onPtyData(
      'pty-capacity',
      '\x1b]0;Codex idle\x07\r\n■ Selected model is at capacity. Please try a different model.\r\n',
      Date.now()
    )
  }
  return { runtime, writes, fail, read, realRead }
}

describe('runtime Codex capacity recovery wiring', () => {
  it('recovers the exact empty composer when a tall recap scrolls its header off a short pane', async () => {
    const visible = {
      handle: 'term-capacity-screen',
      status: 'running' as const,
      source: 'screen' as const,
      composerState: 'unknown' as const,
      tail: [
        '           and the rest of the planned verification remains',
        '           outstanding until the provider recovers.',
        '\u203a Ask Codex to do anything',
        '  GPT-6.1-Sol xhigh \u00b7 C:\\fixture'
      ],
      truncated: false,
      nextCursor: null
    }
    const history = {
      ...visible,
      source: 'stream' as const,
      tail: [
        '\u25a0 Selected model is at capacity. Please try a different model.',
        '\u203a Ask Codex to do anything',
        '\u2022 Generating conversation recap',
        '  \u21b3 Recap: The audit fixture was interrupted by provider capacity',
        '           and the rest of the planned verification remains',
        '           outstanding until the provider recovers.',
        '\u203a Ask Codex to do anything',
        '  GPT-6.1-Sol xhigh \u00b7 C:\\fixture'
      ]
    }
    const readTerminal = vi.fn().mockResolvedValueOnce(visible).mockResolvedValueOnce(history)
    const rendered = await readCapacityRecoveryScreen(
      // SAFETY: This screen-read fixture only uses readTerminal from the full recovery runtime port.
      { readTerminal } as unknown as Parameters<typeof readCapacityRecoveryScreen>[0],
      'term-capacity-screen'
    )
    expect(rendered.composerState).toBe('empty')
    expect(isCodexCapacityScreen(rendered)).toBe(true)
  })

  it('replays a generic Bad Request through the real terminal screen and resumes the active goal', async () => {
    const h = await runtimeWithCapacityRecovery(true)
    vi.spyOn(h.runtime, 'getTerminalSize').mockReturnValue({ cols: 100, rows: 32 })
    h.read.mockImplementation(h.realRead)
    const raw = readFileSync(
      join(import.meta.dirname, '__fixtures__', 'codex-goal-capacity.txt'),
      'utf8'
    ).replaceAll(
      'Selected model is at capacity. Please try a different model.',
      '{"detail":"Bad Request"}'
    )
    expect(raw).toContain('{"detail":"Bad Request"}')
    for (let i = 0; i < raw.length; i += 17) {
      h.runtime.onPtyData('pty-capacity', raw.slice(i, i + 17), Date.now())
      await vi.advanceTimersByTimeAsync(0)
    }
    const recapText = readFileSync(
      join(import.meta.dirname, '__fixtures__', 'codex-capacity-recap-screen.txt'),
      'utf8'
    )
      .replace(
        'Selected model is at capacity. Please try a different model.',
        '{"detail":"Bad Request"}'
      )
      .replace('\n  G\u2026', '\n\n  G\u2026')
    const composerRow = recapText.split('\n').findIndex((line) => line.startsWith('\u203a ')) + 1
    const styled = recapText
      .split('\n')
      .map((line) =>
        line.startsWith('\u203a ')
          ? `\x1b[1m\u203a\x1b[22m \x1b[2m${line.slice(2)}\x1b[22m`
          : line.includes('Goal stalled')
            ? `\x1b[2m${line}\x1b[22m`
            : line
      )
      .join('\r\n')
    const painted = `\x1b]7501;state=error:app=codex\x1b\\\x1b[H\x1b[2J${styled}\x1b[${composerRow};3H\x1b[?25h`
    for (let i = 0; i < painted.length; i += 17) {
      h.runtime.onPtyData('pty-capacity', painted.slice(i, i + 17), Date.now())
      await vi.advanceTimersByTimeAsync(0)
    }
    await vi.advanceTimersByTimeAsync(30_000)
    const rendered = await h.read.mock.results[0]!.value
    expect(rendered).toMatchObject({ source: 'screen', composerState: 'empty' })
    expect(isCodexCapacityScreen(rendered, 'bad-request'), JSON.stringify(rendered)).toBe(true)
    expect(h.writes).toEqual(['/goal resume'])
    h.read.mockResolvedValue({
      handle: 'term-capacity-screen',
      status: 'running',
      source: 'screen',
      composerState: 'draft',
      draft: '/goal resume',
      tail: [],
      truncated: false,
      nextCursor: null
    })
    await vi.advanceTimersByTimeAsync(5_000)
    expect(h.writes).toEqual(['/goal resume', '\r'])
  })

  it.each([
    { manualInput: false, chunkSize: 256, recap: false },
    { manualInput: true, chunkSize: 256, recap: false },
    { manualInput: false, chunkSize: 17, recap: false },
    { manualInput: false, chunkSize: 17, recap: true },
    { manualInput: true, chunkSize: 256, recap: true }
  ])(
    'replays the real goal interruption: $manualInput manual input, $chunkSize byte chunks, recap $recap',
    async ({ manualInput, chunkSize, recap }) => {
      const h = await runtimeWithCapacityRecovery(true)
      vi.spyOn(h.runtime, 'getTerminalSize').mockReturnValue({ cols: 100, rows: 32 })
      const raw = readFileSync(
        join(import.meta.dirname, '__fixtures__', 'codex-goal-capacity.txt'),
        'utf8'
      )
      for (let i = 0; i < raw.length; i += chunkSize) {
        h.runtime.onPtyData('pty-capacity', raw.slice(i, i + chunkSize), Date.now())
        await vi.advanceTimersByTimeAsync(0)
      }
      if (recap) {
        h.read.mockImplementation(h.realRead)
        const recapText = readFileSync(
          join(import.meta.dirname, '__fixtures__', 'codex-capacity-recap-screen.txt'),
          'utf8'
        ).replace('\n  G…', '\n\n  G…')
        const composerRow = recapText.split('\n').findIndex((line) => line.startsWith('› ')) + 1
        // Preserve the real capture's bold prompt, dim placeholder and separated dim footer.
        const styled = recapText
          .split('\n')
          .map((line) =>
            line.startsWith('› ')
              ? `\x1b[1m›\x1b[22m \x1b[2m${line.slice(2)}\x1b[22m`
              : line.includes('Goal stalled')
                ? `\x1b[2m${line}\x1b[22m`
                : line
          )
          .join('\r\n')
        const painted = `\x1b]7501;state=error:app=codex\x1b\\\x1b[H\x1b[2J${styled}\x1b[${composerRow};3H\x1b[?25h`
        for (let i = 0; i < painted.length; i += chunkSize) {
          h.runtime.onPtyData('pty-capacity', painted.slice(i, i + chunkSize), Date.now())
          await vi.advanceTimersByTimeAsync(0)
        }
      }
      if (!recap) {
        h.read.mockResolvedValue({
          handle: 'term-capacity-screen',
          status: 'running',
          source: 'screen',
          composerState: 'empty',
          tail: [
            '■ Selected model is at capacity. Please try a different model.',
            'GPT-6.1-Sol default · fixture Goal stalled (/goal resume)'
          ],
          truncated: false,
          nextCursor: null
        })
      }
      await vi.advanceTimersByTimeAsync(30_000)
      if (recap) {
        const rendered = await h.read.mock.results[0]!.value
        expect(rendered).toMatchObject({ source: 'screen', composerState: 'empty' })
        expect(isCodexCapacityScreen(rendered), JSON.stringify(rendered)).toBe(true)
      }
      expect(h.writes).toEqual(['/goal resume'])
      h.read.mockResolvedValue({
        handle: 'term-capacity-screen',
        status: 'running',
        source: 'screen',
        composerState: 'draft',
        draft: '/goal resume',
        tail: [],
        truncated: false,
        nextCursor: null
      })
      if (manualInput) {
        h.runtime.terminalRunFacts.recordInput('pty-capacity', 'driving', 'my unsent input')
      }
      await vi.advanceTimersByTimeAsync(5_000)
      expect(h.writes).toEqual(manualInput ? ['/goal resume'] : ['/goal resume', '\r'])
    }
  )
  it('continues once when helper completion notices follow the provider failure', async () => {
    const h = await runtimeWithCapacityRecovery(true)
    const captured = readFileSync(
      join(import.meta.dirname, '__fixtures__', 'codex-capacity-completed-screen.txt'),
      'utf8'
    )
    h.read.mockResolvedValue({
      handle: 'term-capacity-screen',
      status: 'running',
      source: 'screen',
      composerState: 'empty',
      tail: captured.trimEnd().split('\n'),
      truncated: false,
      nextCursor: null
    })
    h.fail()
    h.runtime.onPtyData('pty-capacity', captured, Date.now())
    await vi.advanceTimersByTimeAsync(30_000)
    expect(h.writes).toEqual(['Continue'])
    h.read.mockResolvedValue({
      handle: 'term-capacity-screen',
      status: 'running',
      source: 'screen',
      composerState: 'draft',
      draft: 'Continue',
      tail: [],
      truncated: false,
      nextCursor: null
    })
    await vi.advanceTimersByTimeAsync(5_000)
    expect(h.writes).toEqual(['Continue', '\r'])
    await vi.advanceTimersByTimeAsync(120_000)
    expect(h.writes).toHaveLength(2)
  })
  it('continues from the real captured Codex working and idle transitions', async () => {
    const h = await runtimeWithCapacityRecovery(true)
    const raw = readFileSync(
      join(import.meta.dirname, '__fixtures__', 'codex-capacity-overload.txt'),
      'utf8'
    )
    for (let i = 0; i < raw.length; i += 256) {
      h.runtime.onPtyData('pty-capacity', raw.slice(i, i + 256), Date.now())
    }
    await vi.advanceTimersByTimeAsync(30_000)
    expect(h.writes).toEqual(['Continue'])
    h.read.mockResolvedValue({
      handle: 'term-capacity-screen',
      status: 'running',
      source: 'screen',
      composerState: 'draft',
      draft: 'Continue',
      tail: [],
      truncated: false,
      nextCursor: null
    })
    await vi.advanceTimersByTimeAsync(5_000)
    expect(h.writes).toEqual(['Continue', '\r'])
  })
  it('routes a live capacity error through one fenced terminal write', async () => {
    const h = await runtimeWithCapacityRecovery(true)
    h.fail()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(h.writes).toEqual(['Continue'])
    h.read.mockResolvedValue({
      handle: 'term-capacity-screen',
      status: 'running',
      source: 'screen',
      composerState: 'draft',
      draft: 'Continue',
      tail: [],
      truncated: false,
      nextCursor: null
    })
    await vi.advanceTimersByTimeAsync(5_000)
    expect(h.writes).toEqual(['Continue', '\r'])
  })

  it('holds Continue without an Enter when its rendered draft never appears', async () => {
    const h = await runtimeWithCapacityRecovery(true)
    const info = vi.spyOn(console, 'info')
    h.fail()
    await vi.advanceTimersByTimeAsync(100_000)
    expect(h.writes).toEqual(['Continue'])
    expect(info.mock.calls.some(([line]) => String(line).includes('held attempt=1'))).toBe(true)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(h.writes).toEqual(['Continue'])
  })

  it('does nothing unless explicitly enabled', async () => {
    const h = await runtimeWithCapacityRecovery(false)
    h.fail()
    await vi.advanceTimersByTimeAsync(180_000)
    expect(h.read).not.toHaveBeenCalled()
    expect(h.writes).toEqual([])
  })

  it('cancels when desktop input arrives after the failure', async () => {
    const h = await runtimeWithCapacityRecovery(true)
    h.fail()
    h.runtime.terminalRunFacts.recordInput('pty-capacity', 'driving', 'my unsent draft')
    await vi.advanceTimersByTimeAsync(30_000)
    expect(h.writes).toEqual([])
  })
})
