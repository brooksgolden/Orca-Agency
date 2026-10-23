import { afterEach, describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from './orca-runtime-test-mocks.spec'
import { store, TEST_WORKTREE_ID } from './orca-runtime-test-fixtures.spec'
import { WRITE_ACCEPTED } from '../../shared/pty-write-settlement'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

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
  return { runtime, writes, fail, read }
}

describe('runtime Codex capacity recovery wiring', () => {
  it.each([
    { manualInput: false, chunkSize: 256 },
    { manualInput: true, chunkSize: 256 },
    { manualInput: false, chunkSize: 17 }
  ])(
    'replays the real goal interruption: $manualInput manual input, $chunkSize byte chunks',
    async ({ manualInput, chunkSize }) => {
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
      await vi.advanceTimersByTimeAsync(30_000)
      expect(h.writes).toEqual(['/goal resume'])
      h.runtime.onPtyData('pty-capacity', '/goal resume', Date.now())
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
    expect(h.writes).toEqual(['\x1b[200~Continue\x1b[201~\r'])
    await vi.advanceTimersByTimeAsync(120_000)
    expect(h.writes).toHaveLength(1)
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
    expect(h.writes).toEqual(['\x1b[200~Continue\x1b[201~\r'])
  })
  it('routes a live capacity error through one fenced terminal write', async () => {
    const h = await runtimeWithCapacityRecovery(true)
    h.fail()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(h.writes).toEqual(['\x1b[200~Continue\x1b[201~\r'])
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
