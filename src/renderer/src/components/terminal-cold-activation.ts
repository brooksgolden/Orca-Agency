import { useAppStore } from '../store'
import {
  applyBackgroundMountTabRestriction,
  canAdmitTerminalTabsForStartup,
  canDeferColdActivationTabsForHost,
  planColdActivationTabDeferral,
  pruneClosedBackgroundMountTabs,
  revealActivationDeferredTabs
} from './terminal/background-terminal-worktree-mount'
import {
  holdTerminalTabsForStartup,
  releaseStartupTerminalTabHold
} from './terminal/startup-terminal-tab-hold'
import { hasRegisteredRuntimeTerminalTab } from '../runtime/sync-runtime-graph'
import { anyMountedWorktreeHasLayout as computeAnyMountedWorktreeHasLayout } from './terminal/split-group-mount'
import { isParkRestorableTerminalPty } from './terminal-pane/terminal-hidden-view-parking'
import { canWatcherCoverParkedTerminalTab } from './terminal-pane/terminal-parked-tab-watchers'
import { isRemoteRuntimePtyId } from '@/runtime/runtime-terminal-inspection'
import { terminalProviderHasAuthoritativeSnapshot } from './terminal/terminal-provider-snapshot-capability'
import { canDeferUnwatchedVisiblePartnerTab } from './terminal/local-startup-pty-liveness'
import { getResolvedExecutionHostIdForWorktree } from '@/lib/resolved-worktree-execution-host'
import type { TerminalParkingFoundation } from './use-terminal-parking-foundation'

export function applyTerminalColdActivation(controller: TerminalParkingFoundation) {
  const {
    activationDeferralPlanRevisionRef,
    activationDeferredMountTabIdsByWorktreeRef,
    activeGroupIdByWorktree,
    activeTabId,
    activeTabIdByWorktree,
    activeWorktreeDeferralHostId,
    activityTerminalPortals,
    backgroundMountTabIdsByWorktreeRef,
    groupsByWorktree,
    hydrationSucceeded,
    lastActivationWorktreeIdRef,
    layoutByWorktree,
    mountedWorktreeIdsRef,
    pairedRuntimeParkingEnvironmentIds,
    pendingStartupByTabId,
    renderedActiveWorktreeId,
    startupTerminalTabHoldRef,
    startupWorktreeRefreshCompleted,
    tabsByWorktree,
    terminalParkingEnabled,
    terminalTitleSnapshotAuthorityEnabled,
    workspaceSessionReady,
    workspaceSurfaceIds,
    workspaceSurfaceIdSet
  } = controller
  const visibleWorkspaceIds = controller.visibleWorkspaceIds ?? []
  // Why the surface mounts on the tab model alone: the hydrated tabs, groups, and layout are
  // everything the tab strip and the chat, browser, and editor panes need. Only terminal
  // panes wait, held below, for startup restoration to publish PTY ownership — gating the
  // whole surface on that chain left a restored session blank until its last step.
  const startupHeldWorktreeId =
    renderedActiveWorktreeId &&
    !canAdmitTerminalTabsForStartup({
      workspaceSessionReady,
      hydrationSucceeded,
      startupWorktreeRefreshCompleted
    })
      ? renderedActiveWorktreeId
      : null
  releaseStartupTerminalTabHold(
    startupTerminalTabHoldRef,
    backgroundMountTabIdsByWorktreeRef.current,
    mountedWorktreeIdsRef.current,
    startupHeldWorktreeId
  )
  if (renderedActiveWorktreeId && !startupHeldWorktreeId) {
    const worktreeTabs = tabsByWorktree[renderedActiveWorktreeId] ?? []
    const coldActivationDeferralEnabled =
      terminalParkingEnabled && terminalTitleSnapshotAuthorityEnabled
    const immediateTabIds = new Set<string>()
    if (activeTabId) {
      immediateTabIds.add(activeTabId)
    }
    const rememberedActiveTabId = activeTabIdByWorktree[renderedActiveWorktreeId]
    if (rememberedActiveTabId) {
      immediateTabIds.add(rememberedActiveTabId)
    }
    const unifiedTabById = new Map(
      (useAppStore.getState().unifiedTabsByWorktree[renderedActiveWorktreeId] ?? []).map(
        (unifiedTab) => [unifiedTab.id, unifiedTab]
      )
    )
    for (const group of groupsByWorktree[renderedActiveWorktreeId] ?? []) {
      if (!group.activeTabId) {
        continue
      }
      immediateTabIds.add(group.activeTabId)
      const activeUnifiedTab = unifiedTabById.get(group.activeTabId)
      if (activeUnifiedTab?.contentType === 'terminal') {
        immediateTabIds.add(activeUnifiedTab.entityId)
      }
    }
    for (const portal of activityTerminalPortals) {
      if (portal.worktreeId === renderedActiveWorktreeId) {
        immediateTabIds.add(portal.tabId)
      }
    }
    for (const tab of worktreeTabs) {
      if (pendingStartupByTabId[tab.id] !== undefined) {
        immediateTabIds.add(tab.id)
      }
    }
    const activationHostSupportsDeferral = canDeferColdActivationTabsForHost({
      executionHostId: activeWorktreeDeferralHostId,
      pairedRuntimeParkingEnvironmentIds
    })
    const isColdActivationPtyEligible = (ptyId: string): boolean =>
      isRemoteRuntimePtyId(ptyId)
        ? isParkRestorableTerminalPty(ptyId, renderedActiveWorktreeId, {
            pairedRuntimeParkingEnvironmentIds
          })
        : terminalProviderHasAuthoritativeSnapshot(ptyId)
    if (lastActivationWorktreeIdRef.current !== renderedActiveWorktreeId) {
      lastActivationWorktreeIdRef.current = renderedActiveWorktreeId
      const tabById = new Map(worktreeTabs.map((tab) => [tab.id, tab]))
      const installedDeferralPlan = planColdActivationTabDeferral({
        restrictions: backgroundMountTabIdsByWorktreeRef.current,
        deferredMountTabIdsByWorktree: activationDeferredMountTabIdsByWorktreeRef.current,
        worktreeId: renderedActiveWorktreeId,
        allTabIds: worktreeTabs.map((tab) => tab.id),
        isTabLive: (tabId, worktreeId) => hasRegisteredRuntimeTerminalTab(tabId, worktreeId),
        // Why the coverage gate: parked byte watchers own an unmounted tab's bells/titles/completions, so a tab they can't cover must mount immediately.
        isTabDeferrable: (tabId) => {
          const tab = tabById.get(tabId)
          return (
            coldActivationDeferralEnabled &&
            activationHostSupportsDeferral &&
            tab !== undefined &&
            canWatcherCoverParkedTerminalTab(
              renderedActiveWorktreeId,
              tab,
              isColdActivationPtyEligible
            )
          )
        },
        immediateTabIds
      })
      // Why: the install mutates only refs, so without a returned revision the
      // admission drain's effect deps never change and the plan strands.
      if (installedDeferralPlan) {
        activationDeferralPlanRevisionRef.current += 1
      }
    } else if (!coldActivationDeferralEnabled || !activationHostSupportsDeferral) {
      backgroundMountTabIdsByWorktreeRef.current.delete(renderedActiveWorktreeId)
      activationDeferredMountTabIdsByWorktreeRef.current.delete(renderedActiveWorktreeId)
    } else {
      for (const tab of worktreeTabs) {
        if (
          !canWatcherCoverParkedTerminalTab(
            renderedActiveWorktreeId,
            tab,
            isColdActivationPtyEligible
          )
        ) {
          immediateTabIds.add(tab.id)
        }
      }
      revealActivationDeferredTabs({
        restrictions: backgroundMountTabIdsByWorktreeRef.current,
        deferredMountTabIdsByWorktree: activationDeferredMountTabIdsByWorktreeRef.current,
        worktreeId: renderedActiveWorktreeId,
        allTabIds: worktreeTabs.map((tab) => tab.id),
        immediateTabIds
      })
    }
    mountedWorktreeIdsRef.current.add(renderedActiveWorktreeId)
    // A visible split partner must admit its selected terminal without mounting hidden siblings.
    for (const id of visibleWorkspaceIds) {
      if (id !== renderedActiveWorktreeId) {
        const hadRestriction = backgroundMountTabIdsByWorktreeRef.current.has(id)
        const freshPartner = !mountedWorktreeIdsRef.current.has(id) && !hadRestriction
        if (!hadRestriction && !freshPartner) {
          continue
        }
        const partnerTabs = tabsByWorktree[id] ?? []
        const partnerTabIds = new Set(partnerTabs.map((tab) => tab.id))
        const terminalEntityIdByUnifiedId = new Map(
          (useAppStore.getState().unifiedTabsByWorktree[id] ?? [])
            .filter((tab) => tab.contentType === 'terminal')
            .map((tab) => [tab.id, tab.entityId])
        )
        const immediateTabIds = new Set<string>()
        const admit = (tabId: string | null | undefined) => {
          if (!tabId) {
            return
          }
          const entityId = terminalEntityIdByUnifiedId.get(tabId) ?? tabId
          if (partnerTabIds.has(entityId)) {
            immediateTabIds.add(entityId)
          }
        }
        admit(activeTabIdByWorktree[id])
        for (const group of groupsByWorktree[id] ?? []) {
          admit(group.activeTabId)
        }
        for (const portal of activityTerminalPortals) {
          if (portal.worktreeId === id) {
            admit(portal.tabId)
          }
        }
        for (const tab of partnerTabs) {
          if (pendingStartupByTabId[tab.id] !== undefined) {
            admit(tab.id)
          }
        }
        if (freshPartner && coldActivationDeferralEnabled) {
          const state = useAppStore.getState()
          const partnerHostId = getResolvedExecutionHostIdForWorktree(state, id)
          if (
            canDeferColdActivationTabsForHost({
              executionHostId: partnerHostId,
              pairedRuntimeParkingEnvironmentIds
            })
          ) {
            const partnerTabById = new Map(partnerTabs.map((tab) => [tab.id, tab]))
            const installedDeferralPlan = planColdActivationTabDeferral({
              restrictions: backgroundMountTabIdsByWorktreeRef.current,
              deferredMountTabIdsByWorktree: activationDeferredMountTabIdsByWorktreeRef.current,
              worktreeId: id,
              allTabIds: partnerTabs.map((tab) => tab.id),
              isTabLive: (tabId, worktreeId) => hasRegisteredRuntimeTerminalTab(tabId, worktreeId),
              isTabDeferrable: (tabId) => {
                const tab = partnerTabById.get(tabId)
                if (!tab || tab.pendingActivationSpawn) {
                  return false
                }
                const isPtyEligible = (ptyId: string): boolean =>
                  isRemoteRuntimePtyId(ptyId)
                    ? isParkRestorableTerminalPty(ptyId, id, {
                        pairedRuntimeParkingEnvironmentIds
                      })
                    : terminalProviderHasAuthoritativeSnapshot(ptyId)
                return (
                  canWatcherCoverParkedTerminalTab(id, tab, isPtyEligible) ||
                  // Saved IDs are hints. The local startup inventory must prove
                  // every PTY exited before this tab can wait without a watcher.
                  canDeferUnwatchedVisiblePartnerTab(partnerHostId, tab, state)
                )
              },
              immediateTabIds
            })
            if (installedDeferralPlan) {
              activationDeferralPlanRevisionRef.current += 1
            }
          }
        }
        if (activationDeferredMountTabIdsByWorktreeRef.current.has(id)) {
          revealActivationDeferredTabs({
            restrictions: backgroundMountTabIdsByWorktreeRef.current,
            deferredMountTabIdsByWorktree: activationDeferredMountTabIdsByWorktreeRef.current,
            worktreeId: id,
            allTabIds: partnerTabs.map((tab) => tab.id),
            immediateTabIds
          })
        } else if (hadRestriction && immediateTabIds.size > 0) {
          applyBackgroundMountTabRestriction(
            backgroundMountTabIdsByWorktreeRef.current,
            mountedWorktreeIdsRef.current,
            id,
            [...immediateTabIds]
          )
        }
      }
      mountedWorktreeIdsRef.current.add(id)
    }
  } else {
    lastActivationWorktreeIdRef.current = null
  }
  pruneClosedBackgroundMountTabs(
    backgroundMountTabIdsByWorktreeRef.current,
    mountedWorktreeIdsRef.current,
    tabsByWorktree,
    activationDeferredMountTabIdsByWorktreeRef.current
  )
  if (startupHeldWorktreeId) {
    holdTerminalTabsForStartup(
      startupTerminalTabHoldRef,
      backgroundMountTabIdsByWorktreeRef.current,
      mountedWorktreeIdsRef.current,
      startupHeldWorktreeId,
      (tabsByWorktree[startupHeldWorktreeId] ?? []).map((tab) => tab.id)
    )
  }
  for (const id of mountedWorktreeIdsRef.current) {
    if (!workspaceSurfaceIdSet.has(id)) {
      mountedWorktreeIdsRef.current.delete(id)
      backgroundMountTabIdsByWorktreeRef.current.delete(id)
      activationDeferredMountTabIdsByWorktreeRef.current.delete(id)
    }
  }
  const anyMountedWorktreeHasLayout = computeAnyMountedWorktreeHasLayout(
    workspaceSurfaceIds,
    mountedWorktreeIdsRef.current,
    layoutByWorktree,
    groupsByWorktree,
    activeGroupIdByWorktree
  )
  return {
    anyMountedWorktreeHasLayout,
    activationDeferralPlanRevision: activationDeferralPlanRevisionRef.current,
    startupTerminalTabHold: startupTerminalTabHoldRef.current
  }
}

export type TerminalColdActivationController = TerminalParkingFoundation &
  ReturnType<typeof applyTerminalColdActivation>
