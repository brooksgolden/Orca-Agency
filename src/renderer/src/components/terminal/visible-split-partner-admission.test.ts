// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import { registerRuntimeTerminalTab } from '@/runtime/sync-runtime-graph'
import { applyTerminalColdActivation } from '../terminal-cold-activation'
import { shouldMountBackgroundWorktreeTab } from './background-terminal-worktree-mount'
import {
  clearLocalStartupPtyLiveness,
  findSavedPtyTabMounts,
  getLocalStartupPtyLiveness,
  noteLocalStartupPtySpawned,
  refreshLocalStartupPtyLiveness
} from './local-startup-pty-liveness'
import type { TerminalParkingFoundation } from '../use-terminal-parking-foundation'

const PRIMARY = 'repo::/primary'
const PARTNER = 'repo::/partner'
const VISIBLE_TAB = 'partner-visible'
const HIDDEN_TAB = 'partner-hidden'
const SECOND_HIDDEN_TAB = 'partner-hidden-two'
const initialState = useAppStore.getInitialState()

afterEach(() => {
  useAppStore.setState(initialState, true)
  clearLocalStartupPtyLiveness()
})

describe('visible split partner terminal admission', () => {
  it.each([
    { hostId: 'local', shouldDefer: true, hiddenPty: 'none', snapshotCapable: false },
    { hostId: 'local', shouldDefer: true, hiddenPty: 'dead', snapshotCapable: false },
    { hostId: 'local', shouldDefer: true, hiddenPty: 'live', snapshotCapable: false },
    { hostId: 'local', shouldDefer: true, hiddenPty: 'reused', snapshotCapable: false },
    { hostId: 'local', shouldDefer: true, hiddenPty: 'unknown', snapshotCapable: false },
    { hostId: 'ssh:ssh-1', shouldDefer: false, hiddenPty: 'none', snapshotCapable: false },
    {
      hostId: 'runtime:runtime-1',
      shouldDefer: false,
      hiddenPty: 'none',
      snapshotCapable: false
    },
    {
      hostId: 'runtime:runtime-1',
      shouldDefer: true,
      hiddenPty: 'none',
      snapshotCapable: true
    }
  ] as const)(
    'handles a fresh partner on $hostId with $hiddenPty saved PTY and snapshots $snapshotCapable',
    async ({ hostId, shouldDefer, hiddenPty, snapshotCapable }) => {
      const savedPtyId = hiddenPty === 'none' ? null : 'pty-without-snapshot'
      if (savedPtyId && hiddenPty !== 'unknown') {
        await refreshLocalStartupPtyLiveness([savedPtyId], async () =>
          hiddenPty === 'live' ? [{ id: savedPtyId }] : []
        )
      }
      useAppStore.setState({
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: host resolution reads only this worktree's id, repoId, and explicit hostId.
        worktreesByRepo: { repo: [{ id: PARTNER, repoId: 'repo', hostId } as never] },
        unifiedTabsByWorktree: {
          [PARTNER]: [VISIBLE_TAB, HIDDEN_TAB, SECOND_HIDDEN_TAB].map((tabId, index) => ({
            id: `unified-${tabId}`,
            entityId: tabId,
            contentType: 'terminal' as const,
            groupId: 'partner-group',
            worktreeId: PARTNER,
            label: tabId,
            customLabel: null,
            color: null,
            sortOrder: index,
            createdAt: index + 1
          }))
        },
        // Restored IDs are published even when the daemon has lost the process.
        ptyIdsByTabId: savedPtyId ? { [HIDDEN_TAB]: [savedPtyId] } : {}
      })
      const restrictions = new Map<string, ReadonlySet<string>>()
      const deferred = new Map<string, ReadonlySet<string>>()
      const mounted = new Set<string>()
      const partnerGroup = {
        id: 'partner-group',
        worktreeId: PARTNER,
        activeTabId: `unified-${VISIBLE_TAB}`,
        tabOrder: [VISIBLE_TAB, HIDDEN_TAB, SECOND_HIDDEN_TAB].map((id) => `unified-${id}`),
        recentTabIds: []
      }
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: cold activation reads only the supplied controller fields.
      const controller = {
        activationDeferralPlanRevisionRef: { current: 0 },
        activationDeferredMountTabIdsByWorktreeRef: { current: deferred },
        activeGroupIdByWorktree: {},
        activeTabId: null,
        activeTabIdByWorktree: {},
        activeWorktreeDeferralHostId: 'local',
        activityTerminalPortals: [],
        backgroundMountTabIdsByWorktreeRef: { current: restrictions },
        groupsByWorktree: { [PARTNER]: [partnerGroup] },
        hydrationSucceeded: true,
        lastActivationWorktreeIdRef: { current: null },
        layoutByWorktree: {},
        mountedWorktreeIdsRef: { current: mounted },
        pairedRuntimeParkingEnvironmentIds: snapshotCapable
          ? new Set(['runtime-1'])
          : new Set<string>(),
        pendingStartupByTabId: {},
        renderedActiveWorktreeId: PRIMARY,
        startupTerminalTabHoldRef: { current: null },
        startupWorktreeRefreshCompleted: true,
        tabsByWorktree: {
          [PARTNER]: [
            { id: VISIBLE_TAB, worktreeId: PARTNER, ptyId: null },
            {
              id: HIDDEN_TAB,
              worktreeId: PARTNER,
              ptyId: savedPtyId,
              launchAgent: 'codex'
            },
            { id: SECOND_HIDDEN_TAB, worktreeId: PARTNER, ptyId: null, launchAgent: 'claude' }
          ]
        },
        terminalParkingEnabled: true,
        terminalTitleSnapshotAuthorityEnabled: true,
        visibleWorkspaceIds: [PRIMARY, PARTNER],
        workspaceSessionReady: true,
        workspaceSurfaceIds: [PRIMARY, PARTNER],
        workspaceSurfaceIdSet: new Set([PRIMARY, PARTNER])
      } as unknown as TerminalParkingFoundation

      // A new PTY can reuse a saved ID after the inventory. A mounted owner
      // must stay admitted even though that startup answer was "dead".
      const unregister =
        hiddenPty === 'reused'
          ? registerRuntimeTerminalTab({
              tabId: HIDDEN_TAB,
              worktreeId: PARTNER,
              getManager: () => null,
              getContainer: () => null,
              getPtyIdForPane: () => savedPtyId,
              getTabWideAgentHintLeafId: () => null
            })
          : null
      try {
        applyTerminalColdActivation(controller)

        expect(mounted.has(PARTNER)).toBe(true)
        expect(
          shouldMountBackgroundWorktreeTab(restrictions.get(PARTNER) ?? null, VISIBLE_TAB)
        ).toBe(true)
        const hiddenMustMount =
          hiddenPty === 'live' || hiddenPty === 'reused' || hiddenPty === 'unknown'
        expect(restrictions.get(PARTNER)).toEqual(
          shouldDefer
            ? new Set(hiddenMustMount ? [VISIBLE_TAB, HIDDEN_TAB] : [VISIBLE_TAB])
            : undefined
        )
        expect(deferred.get(PARTNER)).toEqual(
          shouldDefer
            ? new Set(hiddenMustMount ? [SECOND_HIDDEN_TAB] : [HIDDEN_TAB, SECOND_HIDDEN_TAB])
            : undefined
        )
        if (shouldDefer && !hiddenMustMount) {
          partnerGroup.activeTabId = `unified-${HIDDEN_TAB}`
          applyTerminalColdActivation(controller)
          expect(restrictions.get(PARTNER)).toEqual(new Set([VISIBLE_TAB, HIDDEN_TAB]))
          expect(deferred.get(PARTNER)).toEqual(new Set([SECOND_HIDDEN_TAB]))
        }
      } finally {
        unregister?.()
      }
    }
  )

  it('treats a failed inventory as unknown and discards an older daemon answer', async () => {
    await refreshLocalStartupPtyLiveness(['saved-pty'], async () => [{ id: 'saved-pty' }])
    expect(getLocalStartupPtyLiveness('saved-pty')).toBe(true)

    let finishOldInventory: ((sessions: { id: string }[]) => void) | undefined
    const oldInventory = refreshLocalStartupPtyLiveness(
      ['saved-pty'],
      () =>
        new Promise((resolve) => {
          finishOldInventory = resolve
        })
    )
    expect(getLocalStartupPtyLiveness('saved-pty')).toBeNull()
    await refreshLocalStartupPtyLiveness(['saved-pty'], async () => {
      throw new Error('daemon unavailable')
    })
    finishOldInventory?.([])
    await oldInventory
    expect(getLocalStartupPtyLiveness('saved-pty')).toBeNull()
  })

  it('bounds the daemon inventory wait and leaves unresolved liveness unknown', async () => {
    vi.useFakeTimers()
    try {
      const inventory = refreshLocalStartupPtyLiveness(
        ['saved-pty'],
        () => new Promise(() => {}),
        25
      )
      await vi.advanceTimersByTimeAsync(25)
      await inventory
      expect(getLocalStartupPtyLiveness('saved-pty')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('promotes a dead saved ID on spawn and targets its exact tab for admission', async () => {
    await refreshLocalStartupPtyLiveness(['saved-pty'], async () => [])
    expect(getLocalStartupPtyLiveness('saved-pty')).toBe(false)
    expect(noteLocalStartupPtySpawned('saved-pty')).toBe(true)
    expect(getLocalStartupPtyLiveness('saved-pty')).toBe(true)
    expect(noteLocalStartupPtySpawned('saved-pty')).toBe(false)
    expect(
      findSavedPtyTabMounts(
        {
          tabsByWorktree: {
            [PARTNER]: [
              { id: VISIBLE_TAB, ptyId: null },
              { id: HIDDEN_TAB, ptyId: null }
            ]
          },
          ptyIdsByTabId: { [HIDDEN_TAB]: ['saved-pty'] },
          pendingReconnectPtyIdByTabId: {},
          terminalLayoutsByTabId: {}
        },
        'saved-pty'
      )
    ).toEqual([{ worktreeId: PARTNER, tabIds: [HIDDEN_TAB] }])
  })

  it('keeps a spawn observed during the inventory when the older list omits it', async () => {
    let finishInventory: ((sessions: { id: string }[]) => void) | undefined
    const inventory = refreshLocalStartupPtyLiveness(
      ['saved-pty'],
      () =>
        new Promise((resolve) => {
          finishInventory = resolve
        })
    )
    expect(noteLocalStartupPtySpawned('saved-pty')).toBe(false)
    finishInventory?.([])
    await inventory
    expect(getLocalStartupPtyLiveness('saved-pty')).toBe(true)
  })

  it.each(['activation deferral', 'targeted background mount'])(
    'admits the selected partner tab without clicking or admitting hidden tabs under %s',
    (restrictionKind) => {
      useAppStore.setState({
        unifiedTabsByWorktree: {
          [PARTNER]: [
            {
              id: 'unified-visible',
              entityId: VISIBLE_TAB,
              contentType: 'terminal',
              groupId: 'partner-group',
              worktreeId: PARTNER,
              label: VISIBLE_TAB,
              customLabel: null,
              color: null,
              sortOrder: 0,
              createdAt: 1
            },
            {
              id: 'unified-hidden',
              entityId: HIDDEN_TAB,
              contentType: 'terminal',
              groupId: 'partner-group',
              worktreeId: PARTNER,
              label: HIDDEN_TAB,
              customLabel: null,
              color: null,
              sortOrder: 1,
              createdAt: 2
            }
          ]
        }
      })
      const restrictions = new Map<string, ReadonlySet<string>>([[PARTNER, new Set()]])
      const deferred = new Map<string, ReadonlySet<string>>(
        restrictionKind === 'activation deferral'
          ? [[PARTNER, new Set([VISIBLE_TAB, HIDDEN_TAB])]]
          : []
      )
      const mounted = new Set<string>([PARTNER])
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: cold activation reads only the fields supplied here; unrelated controller machinery is not used.
      const controller = {
        activationDeferralPlanRevisionRef: { current: 0 },
        activationDeferredMountTabIdsByWorktreeRef: { current: deferred },
        activeGroupIdByWorktree: {},
        activeTabId: null,
        activeTabIdByWorktree: {},
        activeWorktreeDeferralHostId: 'local',
        activityTerminalPortals: [],
        backgroundMountTabIdsByWorktreeRef: { current: restrictions },
        groupsByWorktree: {
          [PARTNER]: [
            {
              id: 'partner-group',
              worktreeId: PARTNER,
              activeTabId: 'unified-visible',
              tabOrder: ['unified-visible', 'unified-hidden'],
              recentTabIds: []
            }
          ]
        },
        hydrationSucceeded: true,
        lastActivationWorktreeIdRef: { current: null },
        layoutByWorktree: {},
        mountedWorktreeIdsRef: { current: mounted },
        pairedRuntimeParkingEnvironmentIds: new Set<string>(),
        pendingStartupByTabId: {},
        renderedActiveWorktreeId: PRIMARY,
        startupTerminalTabHoldRef: { current: null },
        startupWorktreeRefreshCompleted: true,
        tabsByWorktree: {
          [PARTNER]: [
            { id: VISIBLE_TAB, worktreeId: PARTNER, ptyId: null },
            { id: HIDDEN_TAB, worktreeId: PARTNER, ptyId: null }
          ]
        },
        terminalParkingEnabled: false,
        terminalTitleSnapshotAuthorityEnabled: false,
        visibleWorkspaceIds: [PRIMARY, PARTNER],
        workspaceSessionReady: true,
        workspaceSurfaceIds: [PRIMARY, PARTNER],
        workspaceSurfaceIdSet: new Set([PRIMARY, PARTNER])
      } as unknown as TerminalParkingFoundation

      applyTerminalColdActivation(controller)

      const admitted = restrictions.get(PARTNER) ?? null
      expect(shouldMountBackgroundWorktreeTab(admitted, VISIBLE_TAB)).toBe(true)
      expect(shouldMountBackgroundWorktreeTab(admitted, HIDDEN_TAB)).toBe(false)
      expect(mounted.has(PARTNER)).toBe(true)
      expect(deferred.get(PARTNER)).toEqual(
        restrictionKind === 'activation deferral' ? new Set([HIDDEN_TAB]) : undefined
      )
    }
  )
})
