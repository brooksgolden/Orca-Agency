import { afterEach, describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from './orca-runtime-test-mocks.spec'
import { store, TEST_WORKTREE_ID } from './orca-runtime-test-fixtures.spec'
import { WRITE_ACCEPTED } from '../../shared/pty-write-settlement'

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
