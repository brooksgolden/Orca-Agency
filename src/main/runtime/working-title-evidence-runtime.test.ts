import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { OrcaRuntimeService } from './orca-runtime-test-mocks.spec'
import { store, TEST_WORKTREE_ID } from './orca-runtime-test-fixtures.spec'
import { makeAgentStatusStoreWiring } from './agent-status-store-wiring.test-fixture'
import { AGENT_STATUS_STALE_AFTER_MS } from '../../shared/agent-status-types'
import { makePaneKey } from '../../shared/stable-pane-id'
import fixture from './__fixtures__/codex-compact-recovery-titles.json'
import {
  AgentStatusObservedPaneIdentities,
  recordObservedAgentStatusPaneIdentity
} from './agent-status-observed-pane-identity'
import { buildBody, postHookEvent } from '../agent-hooks/server.test-fixtures'
import type { AgentHookServer } from '../agent-hooks/server'

const leafId = '11111111-1111-4111-8111-111111111111'
const paneKey = makePaneKey('tab-1', leafId)

class EvidenceRuntime extends OrcaRuntimeService {
  readPromptLifecycle() {
    return this.agentPromptLifecycleByPtyId.get('pty-1')
  }

  setRetainedLaunchToken(token: string | null) {
    this.ptysById.get('pty-1')!.launchToken = token
  }
}

const servers: AgentHookServer[] = []
afterEach(() => {
  for (const server of servers.splice(0)) {
    server.stop()
  }
  vi.useRealTimers()
})

async function setup(launchToken?: string) {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(1_000)
  const wiring = makeAgentStatusStoreWiring()
  servers.push(wiring.statusStore)
  const identities = new AgentStatusObservedPaneIdentities()
  const runtime = new EvidenceRuntime(store, undefined, {
    ...wiring.deps,
    readObservedAgentStatusPaneIdentity: (key) => identities.read(key)
  })
  runtime.setPtyController({
    spawn: vi.fn().mockResolvedValue({ id: 'pty-1' }),
    write: () => true,
    kill: () => true,
    getForegroundProcess: async () => 'codex'
  })
  runtime.attachWindow(1)
  runtime.syncWindowGraph(1, {
    tabs: [
      {
        tabId: 'tab-1',
        worktreeId: TEST_WORKTREE_ID,
        title: 'Codex',
        activeLeafId: leafId,
        layout: null
      }
    ],
    leaves: [
      {
        tabId: 'tab-1',
        worktreeId: TEST_WORKTREE_ID,
        leafId,
        paneRuntimeId: 1,
        ptyId: 'pty-1',
        paneTitle: null
      }
    ]
  })
  runtime.onPtyData('pty-1', fixture.frames[0], Date.now())
  await new Promise<void>((resolve) => setImmediate(resolve))
  const terminalHandle = runtime.getAgentStatusTerminalHandleForPaneKey(paneKey)
  expect(terminalHandle).toBeTruthy()
  if (launchToken) {
    runtime.setRetainedLaunchToken(launchToken)
  }
  wiring.statusStore.setListener((event) =>
    recordObservedAgentStatusPaneIdentity(identities, event.paneKey, runtime)
  )
  await wiring.statusStore.start({ env: 'production' })
  const response = await postHookEvent(
    wiring.statusStore,
    buildBody(
      {
        hook_event_name: 'UserPromptSubmit',
        prompt: 'Continue after compaction',
        session_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      },
      { paneKey, worktreeId: TEST_WORKTREE_ID, launchToken }
    ),
    '/hook/codex'
  )
  expect(response.status).toBe(204)
  const previous = wiring.statusStore.getStatusSnapshot()[0]
  expect(previous).toMatchObject({ state: 'working', observation: { origin: 'hook' } })
  expect(previous.providerSession).toEqual({
    key: 'session_id',
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  })
  expect(previous.terminalHandle).toBeUndefined()
  expect(identities.read(paneKey)).toMatchObject({ kind: 'observed', terminalHandle })
  const listener = vi.fn()
  wiring.statusStore.setListener(listener)
  listener.mockClear()
  vi.setSystemTime(1_001 + AGENT_STATUS_STALE_AFTER_MS)
  return { runtime, wiring, previous, listener, identities }
}

function restoreWorkingRow(context: Awaited<ReturnType<typeof setup>>) {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Exercise the server's real persistence boundary without starting another HTTP listener.
  const internal = context.wiring.statusStore as unknown as {
    serializeStatusFile(): string
    hydrateLastStatusFromDisk(): void
    lastStatusFilePath: string | null
  }
  const timing = context.wiring.statusStore.getStatusSnapshot()[0]
  const directory = mkdtempSync(join(tmpdir(), 'orca-working-title-'))
  const originalPath = internal.lastStatusFilePath
  try {
    internal.lastStatusFilePath = join(directory, 'last-status.json')
    writeFileSync(internal.lastStatusFilePath, internal.serializeStatusFile())
    internal.hydrateLastStatusFromDisk()
  } finally {
    internal.lastStatusFilePath = originalPath
    rmSync(directory, { recursive: true, force: true })
  }
  const restored = context.wiring.statusStore.getStatusSnapshot()[0]
  expect(restored.restoredUnconfirmed).toBe(true)
  expect(restored.terminalHandle).toBeUndefined()
  vi.spyOn(context.identities, 'read').mockReturnValue({ kind: 'unobserved' })
  return timing
}

describe('main runtime working-title evidence', () => {
  it.each(['retained-launch', null, 'replacement-launch'])(
    'checks the saved launch commitment against %s after real persistence',
    async (launchToken) => {
      const context = await setup('retained-launch')
      restoreWorkingRow(context)
      const previous = context.wiring.statusStore.getStatusSnapshot()[0]
      context.runtime.setRetainedLaunchToken(launchToken)
      context.runtime.onPtyData('pty-1', fixture.frames[1], Date.now())
      if (launchToken === 'retained-launch' || launchToken === null) {
        expect(context.wiring.statusStore.getStatusSnapshot()[0]).toMatchObject({
          state: 'working',
          terminalHandle: context.runtime.getAgentStatusTerminalHandleForPaneKey(paneKey)
        })
        expect(
          context.wiring.statusStore.getStatusSnapshot()[0].restoredUnconfirmed
        ).toBeUndefined()
        expect(context.listener).toHaveBeenCalledTimes(1)
        if (launchToken === null) {
          expect(context.wiring.statusStore.getStatusSnapshot()[0]).toMatchObject({
            prompt: '',
            stateStartedAt: previous.stateStartedAt,
            turnStartedAt: previous.turnStartedAt,
            observation: { origin: 'osc' }
          })
          expect(context.wiring.statusStore.getStatusSnapshot()[0].providerSession).toEqual(
            previous.providerSession
          )
          // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Read the real server's protected serializer to verify resume identity and the existing commitment survive.
          const persistence = context.wiring.statusStore as unknown as {
            serializeStatusFile(): string
          }
          const saved = JSON.parse(persistence.serializeStatusFile()).entries[paneKey]
          expect(saved.providerSession).toEqual(previous.providerSession)
          expect(saved.source).toBeUndefined()
          expect(saved.hookEventName).toBeUndefined()
          expect(saved.launchToken).toBeUndefined()
          expect(saved.launchTokenHash).toBe(
            createHash('sha256').update('retained-launch').digest('hex')
          )
        }
      } else {
        expect(context.wiring.statusStore.getStatusSnapshot()[0]).toEqual(previous)
        expect(context.listener).not.toHaveBeenCalled()
      }
    }
  )

  it('confirms a cold restored working row from fresh native output without a new prompt', async () => {
    const context = await setup()
    const previous = restoreWorkingRow(context)
    context.runtime.onPtyData('pty-1', fixture.frames[1], Date.now())
    const confirmed = context.wiring.statusStore.getStatusSnapshot()[0]
    expect(confirmed.restoredUnconfirmed).toBeUndefined()
    expect(confirmed).toMatchObject({
      state: 'working',
      stateStartedAt: previous.stateStartedAt,
      turnStartedAt: previous.turnStartedAt,
      prompt: '',
      evidenceObservedAt: Date.now(),
      terminalHandle: context.runtime.getAgentStatusTerminalHandleForPaneKey(paneKey)
    })
    expect(context.listener).toHaveBeenCalledTimes(1)
  })

  it.each(['synthetic', 'snapshot', 'idle', 'permission', 'closed'])(
    'does not confirm a restored row from %s evidence',
    async (kind) => {
      const context = await setup()
      restoreWorkingRow(context)
      const previous = context.wiring.statusStore.getStatusSnapshot()[0]
      if (kind === 'synthetic') {
        context.runtime.ingestSyntheticTitleFrame('pty-1', fixture.frames[1])
      } else if (kind === 'snapshot') {
        context.runtime.getTerminalSideEffectSnapshot('pty-1')
      } else {
        if (kind === 'closed') {
          context.runtime.markGraphUnavailable(1)
        }
        context.runtime.onPtyData(
          'pty-1',
          kind === 'closed'
            ? fixture.frames[1]
            : `${fixture.frames[1]}\x1b]0;Codex ${kind === 'idle' ? 'idle' : 'waiting for permission'}\x07`,
          Date.now()
        )
      }
      expect(context.wiring.statusStore.getStatusSnapshot()[0]).toEqual(previous)
      expect(context.listener).not.toHaveBeenCalled()
    }
  )
  it.each(['idle', 'waiting for permission'])(
    'preserves the final %s lifecycle when working and settled titles share a chunk',
    async (title) => {
      const { runtime, wiring } = await setup()
      const previousSequence = runtime.readPromptLifecycle()?.workingSequence
      expect(previousSequence).toEqual(expect.any(Number))
      runtime.onPtyData('pty-1', `${fixture.frames[1]}\x1b]0;Codex ${title}\x07`, Date.now())
      expect(runtime.readPromptLifecycle()).toMatchObject({
        status: title === 'idle' ? 'idle' : 'permission',
        workingSequence: previousSequence
      })
      expect(wiring.statusStore.getStatusSnapshot()[0].evidenceObservedAt).toBe(Date.now())
    }
  )

  it('renews a stale hook from captured provider output without a mounted renderer consumer', async () => {
    const { runtime, wiring, previous, listener } = await setup()
    runtime.onPtyData('pty-1', fixture.frames[1], Date.now())
    expect(wiring.statusStore.getStatusSnapshot()[0]).toMatchObject({
      evidenceObservedAt: Date.now(),
      stateStartedAt: previous.stateStartedAt,
      prompt: previous.prompt,
      turnStartedAt: previous.turnStartedAt,
      observation: {
        origin: 'hook',
        kind: 'snapshot',
        incarnation: previous.observation?.incarnation
      }
    })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('rejects titles from a replacement process even with the same handle', async () => {
    const { runtime, wiring, previous, listener, identities } = await setup()
    const observed = identities.read(paneKey)
    if (observed.kind !== 'observed') {
      throw new Error('Missing captured hook owner')
    }
    identities.record(paneKey, { ...observed, processIncarnation: 'previous-process' })
    runtime.onPtyData('pty-1', fixture.frames[1], Date.now())
    expect(wiring.statusStore.getStatusSnapshot()[0]).toEqual(previous)
    expect(listener).not.toHaveBeenCalled()
  })

  it('does not renew an owner after its authoritative graph is removed', async () => {
    const { runtime, wiring, previous, listener } = await setup()
    runtime.markGraphUnavailable(1)
    runtime.onPtyData('pty-1', fixture.frames[1], Date.now())
    expect(wiring.statusStore.getStatusSnapshot()[0]).toEqual(previous)
    expect(listener).not.toHaveBeenCalled()
  })

  it('does not renew a stale row from synthetic hook spinner frames', async () => {
    const { runtime, wiring, previous, listener } = await setup()
    runtime.ingestSyntheticTitleFrame('pty-1', fixture.frames[1])
    expect(wiring.statusStore.getStatusSnapshot()[0]).toEqual(previous)
    expect(listener).not.toHaveBeenCalled()
  })

  it('a title snapshot read does not renew the stale row', async () => {
    const { runtime, wiring, previous, listener } = await setup()
    runtime.getTerminalSideEffectSnapshot('pty-1')
    expect(wiring.statusStore.getStatusSnapshot()[0]).toEqual(previous)
    expect(listener).not.toHaveBeenCalled()
  })
})
