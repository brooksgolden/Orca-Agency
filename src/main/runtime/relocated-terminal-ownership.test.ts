import { afterEach, describe, expect, it, vi } from 'vitest'
import { getDefaultWorkspaceSession } from '../../shared/constants'
import { makePaneKey } from '../../shared/stable-pane-id'
import { OrcaRuntimeService } from './orca-runtime'
import type { ResolvedWorktree } from './runtime-worktree-path-identity'
import { registerPty, unregisterPty, reassignRegisteredPtyWorkspace } from '../memory/pty-registry'
import { sweepProviderByPrefix } from './worktree-pty-surface-sweeps'

const OLD = 'folder:original',
  NEW = 'folder:separate',
  PTY = `${OLD}@@same-process`
const LEAF = '11111111-1111-4111-8111-111111111111'
function workspace(id: string): ResolvedWorktree {
  return {
    id,
    repoId: 'repo',
    path: '/same-folder',
    displayName: id,
    head: '',
    branch: '',
    isBare: false,
    comment: '',
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 1,
    isMainWorktree: false,
    parentWorktreeId: null,
    childWorktreeIds: [],
    lineage: null,
    git: { path: '/same-folder', head: '', branch: '', isBare: false, isMainWorktree: false }
  }
}
class MoveRuntime extends OrcaRuntimeService {
  async inventory() {
    await this.refreshPtyWorktreeRecordsWithControllerInventory([workspace(OLD), workspace(NEW)])
    return this.ptysById.get(PTY)?.worktreeId
  }
}

afterEach(() => unregisterPty(PTY))
describe('a moved conversation keeps its original live process', () => {
  it.each([true, false])(
    'restores a moved owner only with matching incarnation=%s',
    async (matches) => {
      const session = getDefaultWorkspaceSession()
      session.tabsByWorktree[NEW] = [
        {
          id: 'tab',
          worktreeId: NEW,
          ptyId: PTY,
          title: 'Chat',
          customTitle: null,
          color: null,
          sortOrder: 0,
          createdAt: 1,
          relocatedFromWorktreeIds: [OLD]
        }
      ]
      session.terminalLayoutsByTabId.tab = {
        root: { type: 'leaf', leafId: LEAF },
        activeLeafId: LEAF,
        expandedLeafId: null,
        ptyIdsByLeafId: { [LEAF]: PTY }
      }
      session.terminalPtyIncarnationsByPaneKey = { [makePaneKey('tab', LEAF)]: 'live-generation' }
      const store = { getWorkspaceSession: () => session }
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: this fixture only exercises controller inventory and its persisted session read.
      const runtime = new MoveRuntime(store as never)
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: inventory calls only this controller's listProcesses method.
      runtime.setPtyController({
        listProcesses: async () => [
          {
            id: PTY,
            worktreeId: OLD,
            incarnationId: matches ? 'live-generation' : 'replacement',
            cwd: '/same-folder'
          }
        ]
      } as never)
      expect(await runtime.inventory()).toBe(matches ? NEW : OLD)
    }
  )

  it('does not stop a moved process when its original workspace is removed', async () => {
    registerPty({ ptyId: PTY, worktreeId: OLD, sessionId: null, paneKey: null, pid: 123 })
    reassignRegisteredPtyWorkspace(PTY, NEW)
    const shutdown = vi.fn(async () => {})
    const provider = { listProcesses: async () => [{ id: PTY, worktreeId: OLD }], shutdown }
    const stop = async (_id: string, action: () => Promise<boolean>) => ({
      stopped: await action(),
      owner: true
    })
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: this sweep requires only listProcesses and shutdown, both supplied.
    expect(await sweepProviderByPrefix(OLD, provider as never, Date.now() + 1000, stop)).toBe(0)
    expect(shutdown).not.toHaveBeenCalled()
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: same provider fixture exercises the destination's positive ownership.
    expect(await sweepProviderByPrefix(NEW, provider as never, Date.now() + 1000, stop)).toBe(1)
    expect(shutdown).toHaveBeenCalledOnce()
  })
  it('protects a cold moved terminal before any registry hydration or pane visit', async () => {
    const saved = getDefaultWorkspaceSession()
    saved.tabsByWorktree[NEW] = [
      {
        id: 'tab',
        worktreeId: NEW,
        ptyId: PTY,
        title: 'Chat',
        customTitle: null,
        color: null,
        sortOrder: 0,
        createdAt: 1,
        relocatedFromWorktreeIds: [OLD]
      }
    ]
    saved.terminalLayoutsByTabId.tab = {
      root: { type: 'leaf', leafId: LEAF },
      activeLeafId: LEAF,
      expandedLeafId: null,
      ptyIdsByLeafId: { [LEAF]: PTY }
    }
    saved.terminalPtyIncarnationsByPaneKey = { [makePaneKey('tab', LEAF)]: 'exact-generation' }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: this cold runtime only reads its persisted workspace session.
    const runtime = new MoveRuntime({ getWorkspaceSession: () => saved } as never)
    const session = {
      id: PTY,
      worktreeId: OLD,
      incarnationId: 'exact-generation',
      cwd: '/same-folder',
      title: 'Chat',
      pid: 123
    }
    const shutdown = vi.fn(async () => {})
    const provider = { listProcesses: async () => [session], shutdown }
    const stop = async (_id: string, action: () => Promise<boolean>) => ({
      stopped: await action(),
      owner: true
    })
    await sweepProviderByPrefix(
      OLD,
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: only the supplied inventory and shutdown methods are used.
      provider as never,
      Date.now() + 1000,
      stop,
      undefined,
      false,
      (row) => runtime.resolveLocalTerminalMoveWorkspace(row)
    )
    expect(shutdown).not.toHaveBeenCalled()
    expect(
      runtime.resolveLocalTerminalMoveWorkspace({
        ...session,
        incarnationId: 'different-generation'
      })
    ).toBeNull()
  })
})
