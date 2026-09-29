import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConnectPanePtySession } from './connect-pane-pty-session'
import { runDeferredSessionReattachChoice } from './deferred-session-reattach-choice'

/**
 * A workspace identity migration re-keys tabs but not live PTYs, which keep the id they were
 * minted with. Rejecting those here sent every migrated pane down the plain attach path, which
 * never asks the daemon to replay, so live agents showed a black terminal.
 */
const mocks = vi.hoisted(() => {
  const holder: {
    state: Record<string, unknown>
    startDeferredSessionReattach: ReturnType<typeof vi.fn>
  } = {
    state: {},
    startDeferredSessionReattach: vi.fn()
  }
  return holder
})

vi.mock('@/store', () => ({ useAppStore: { getState: () => mocks.state } }))
vi.mock('@/runtime/sync-runtime-graph', () => ({ scheduleRuntimeGraphSync: vi.fn() }))
vi.mock('@/runtime/runtime-terminal-stream', () => ({
  getRemoteRuntimePtyEnvironmentId: () => null
}))
vi.mock('../pty-dispatcher', () => ({ getEagerPtyBufferHandle: () => undefined }))
vi.mock('./deferred-session-reattach-connect', () => ({
  startDeferredSessionReattach: mocks.startDeferredSessionReattach
}))

const OLD_ID = 'b3336966::C:/dev/claude/General::workspace:f23cd281'
const NEW_ID = 'f63d7fa2::C:/dev/claude/Local Apps/Orca::workspace:f23cd281'
const LIVE_PTY = `${OLD_ID}@@867d8f22`
const LEAF = '54554ce8-4673-4d11-bcad-1dabb5babc88'

function seedStore(args: {
  tabPtyId: string | null
  worktrees: { id: string; priorWorktreeIds?: string[] }[]
}) {
  mocks.state = {
    tabsByWorktree: { [NEW_ID]: [{ id: 'tab-1', ptyId: args.tabPtyId, worktreeId: NEW_ID }] },
    ptyIdsByTabId: {},
    worktreesByRepo: { repo: args.worktrees }
  }
}

function buildSession(restoredPtyId: string) {
  const transport = { attach: vi.fn(), getPtyId: vi.fn(() => null) }
  const startFreshSpawn = vi.fn()
  const session = {
    pane: { id: 1 },
    transport,
    hadExistingPaneTransportAtConnect: false,
    runtimeEnvironmentId: null,
    mountFollowsTerminalPark: false,
    pendingSpawnKey: `deferred-choice-test:${Math.random()}`,
    tabGeneration: 0,
    getSleepingRecordForPane: () => null,
    buildColdRestoreAgentResumeStartup: vi.fn(),
    syncPanePtyLayoutBinding: vi.fn(),
    startFreshSpawn,
    startFreshColdRestoreAgentResume: vi.fn(),
    deps: {
      worktreeId: NEW_ID,
      tabId: 'tab-1',
      restoredLeafId: LEAF,
      restoredPtyIdByLeafId: { [LEAF]: restoredPtyId },
      paneTransportsRef: { current: new Map() },
      clearTabPtyId: vi.fn()
    }
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the choice reads only the fields built above; the rest of the session is unreachable on these paths.
  return { session: session as unknown as ConnectPanePtySession, transport, startFreshSpawn }
}

describe('deferred session reattach choice', () => {
  beforeEach(() => {
    mocks.startDeferredSessionReattach.mockClear()
  })

  it('reattaches a live PTY minted under the workspace prior id instead of a blind attach', () => {
    seedStore({ tabPtyId: LIVE_PTY, worktrees: [{ id: NEW_ID, priorWorktreeIds: [OLD_ID] }] })
    const { session, transport, startFreshSpawn } = buildSession(LIVE_PTY)

    runDeferredSessionReattachChoice(session)

    expect(mocks.startDeferredSessionReattach).toHaveBeenCalledWith(session, LIVE_PTY)
    expect(transport.attach).not.toHaveBeenCalled()
    expect(startFreshSpawn).not.toHaveBeenCalled()
  })

  it('still refuses a foreign workspace PTY and spawns fresh', () => {
    seedStore({ tabPtyId: null, worktrees: [{ id: NEW_ID, priorWorktreeIds: [OLD_ID] }] })
    const { session, transport, startFreshSpawn } = buildSession(
      'other::C:/dev/claude/Personal@@867d8f22'
    )

    runDeferredSessionReattachChoice(session)

    expect(mocks.startDeferredSessionReattach).not.toHaveBeenCalled()
    expect(transport.attach).not.toHaveBeenCalled()
    expect(startFreshSpawn).toHaveBeenCalled()
  })

  it('refuses a prior-id PTY once a live workspace uses that id again', () => {
    seedStore({
      tabPtyId: null,
      worktrees: [{ id: NEW_ID, priorWorktreeIds: [OLD_ID] }, { id: OLD_ID }]
    })
    const { session, startFreshSpawn } = buildSession(LIVE_PTY)

    runDeferredSessionReattachChoice(session)

    expect(mocks.startDeferredSessionReattach).not.toHaveBeenCalled()
    expect(startFreshSpawn).toHaveBeenCalled()
  })
})
