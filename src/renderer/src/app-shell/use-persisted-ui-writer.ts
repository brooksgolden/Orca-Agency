import { isPersistedUIWriteField } from '@/store/slices/persisted-ui-write-baseline'
import { useEffect, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '../store'
import {
  capturePersistedUIWriteBaseline,
  diffPersistedUIWriteFields,
  persistedUIWriteFieldsToWireUpdate,
  quarantineRejectedPersistedUIWriteFields,
  type PersistedUIWriteBaseline
} from '../store/slices/persisted-ui-write-baseline'

// Sends one patch through setWithAck (web's plain set swallows transport failures) and folds it
// into the baseline on ack, generation-guarded so a hydration mid-flight wins. A transport
// rejection folds nothing — the fields stay dirty for the next edit, never an automatic retry —
// but a host that refuses the keys outright would refuse them forever, so those are quarantined.
type PersistedUIWriteController = {
  activate: () => void
  send: (changed: Partial<PersistedUIWriteBaseline>) => void
  scheduleTrailing: () => void
  dispose: () => void
}

function createPersistedUIWriteController(): PersistedUIWriteController {
  let disposed = false
  let trailingTimer: number | null = null

  const scheduleTrailing = (): void => {
    if (disposed) {
      return
    }
    if (trailingTimer !== null) {
      window.clearTimeout(trailingTimer)
    }
    trailingTimer = window.setTimeout(() => {
      trailingTimer = null
      if (disposed) {
        return
      }
      const state = useAppStore.getState()
      if (Object.keys(state.persistedUIWriteInFlightCounts).length > 0) {
        return
      }
      const baseline = state.persistedUIWriteBaseline
      if (!baseline) {
        return
      }
      const trailing = diffPersistedUIWriteFields(capturePersistedUIWriteBaseline(state), baseline)
      if (Object.keys(trailing).length > 0) {
        controller.send(trailing)
      }
    }, 150)
  }

  const send = (changed: Partial<PersistedUIWriteBaseline>): void => {
    if (disposed) {
      return
    }
    const fields = Object.keys(changed).filter(isPersistedUIWriteField)
    const state = useAppStore.getState()
    const sentAtGeneration = state.persistedUIWriteBaselineGeneration
    state.notePersistedUIWriteStarted(fields)
    let request: Promise<void>
    try {
      // Use acknowledged writes when available; older preloads fall back to set, which web may silently reject.
      const send = window.api.ui.setWithAck ?? window.api.ui.set
      request = send(persistedUIWriteFieldsToWireUpdate(changed))
    } catch {
      // Settle even synchronous failure so fields cannot stay pinned against hydration forever.
      useAppStore.getState().notePersistedUIWriteSettled(fields, null)
      return
    }
    // Use two-argument then so an ack-handler throw cannot trigger double settlement in the rejection branch.
    request.then(
      () => {
        useAppStore.getState().notePersistedUIWriteSettled(fields, changed, { sentAtGeneration })
        scheduleTrailing()
      },
      (error: unknown) => {
        // An old host's strict schema rejects the whole batch on one unknown key; folding
        // those keys as-if-persisted stops them poisoning every later patch, and the
        // batch-mates they took down with them are re-sent by the trailing flush.
        const quarantined = quarantineRejectedPersistedUIWriteFields(error, changed)
        useAppStore
          .getState()
          .notePersistedUIWriteSettled(fields, quarantined, { sentAtGeneration })
        // Preserve a pending edit made during this round trip, but don't retry the
        // rejected patch itself: a terminal transport failure must not loop.
        const state = useAppStore.getState()
        const baseline = state.persistedUIWriteBaseline
        const dirty = baseline
          ? diffPersistedUIWriteFields(capturePersistedUIWriteBaseline(state), baseline)
          : {}
        const current = capturePersistedUIWriteBaseline(state)
        const changedDuringFlight = fields.some(
          (field) => !Object.is(current[field], changed[field])
        )
        const quarantinedFields = Object.keys(quarantined ?? {})
        const shouldRetry =
          changedDuringFlight ||
          Object.keys(dirty).some(
            (field) =>
              !fields.some((sent) => sent === field) ||
              (quarantinedFields.length > 0 && !quarantinedFields.includes(field))
          )
        if (shouldRetry) {
          scheduleTrailing()
        }
      }
    )
  }

  const controller: PersistedUIWriteController = {
    activate: () => {
      disposed = false
    },
    send,
    scheduleTrailing,
    dispose: () => {
      disposed = true
      if (trailingTimer !== null) {
        window.clearTimeout(trailingTimer)
        trailingTimer = null
      }
    }
  }
  return controller
}

// Mirrors the writer-owned preferences into the durable UI file as field-level diffs (STA-5781:
// whole-snapshot writes let a stale mirror clobber another client's fields). activeView stays
// off this debounced writer (#9002) so a view switch never schedules a durable-state write.
export function usePersistedUIWriter(): void {
  const controller = useMemo(() => createPersistedUIWriteController(), [])
  const persistedUIReady = useAppStore((s) => s.persistedUIReady)
  const activeView = useAppStore((s) => s.activeView)
  const ui = useAppStore(
    useShallow((s): PersistedUIWriteBaseline => ({
      sidebarWidth: s.sidebarWidth,
      sidebarOpen: s.sidebarOpen,
      rightSidebarOpen: s.rightSidebarOpen,
      rightSidebarTab: s.rightSidebarTab,
      rightSidebarExplorerView: s.rightSidebarExplorerView,
      rightSidebarWidth: s.rightSidebarWidth,
      markdownTocPanelWidth: s.markdownTocPanelWidth,
      combinedDiffFileTreeWidth: s.combinedDiffFileTreeWidth,
      groupBy: s.groupBy,
      sortBy: s.sortBy,
      projectOrderBy: s.projectOrderBy,
      showSleepingWorkspaces: s.showSleepingWorkspaces,
      workspaceHostScope: s.workspaceHostScope,
      visibleWorkspaceHostIds: s.visibleWorkspaceHostIds,
      hideDefaultBranchWorkspace: s.hideDefaultBranchWorkspace,
      hideAutomationGeneratedWorkspaces: s.hideAutomationGeneratedWorkspaces,
      hideCliCreatedWorkspaces: s.hideCliCreatedWorkspaces,
      hideDetachedHeadWorkspaces: s.hideDetachedHeadWorkspaces,
      hideWorkspacesFromOtherDevices: s.hideWorkspacesFromOtherDevices,
      alwaysShowDefaultBranchWorkspace: s.alwaysShowDefaultBranchWorkspace,
      explorerDisplayRootByWorktree: s.explorerDisplayRootByWorktree,
      showDotfilesByWorktree: s.showDotfilesByWorktree,
      filterRepoIds: s.filterRepoIds,
      // Persist focus/visibility acknowledgements and close/dismiss cleanup by map identity so retained rows do not return unread after restart.
      acknowledgedAgentsByPaneKey: s.acknowledgedAgentsByPaneKey,
      // Retain Clear completed across restart.
      activityClearedAtByPaneKey: s.activityClearedAtByPaneKey,
      // Why: an explicit "mark unread" must survive restart, or the row comes back read.
      manuallyUnreadTurnsByPaneKey: s.manuallyUnreadTurnsByPaneKey,
      sessionsGridPreset: s.sessionsGridPreset,
      sessionsGridZoom: s.sessionsGridZoom,
      sessionsGridShowEmpty: s.sessionsGridShowEmpty,
      sessionsGridFilter: s.sessionsGridFilter,
      sessionsGridStateFilter: s.sessionsGridStateFilter,
      sessionsGridScrollMode: s.sessionsGridScrollMode,
      sessionsGridWheelTarget: s.sessionsGridWheelTarget,
      sessionsGridTabOrder: s.sessionsGridTabOrder,
      sessionsGridHiddenTabIds: s.sessionsGridHiddenTabIds
    }))
  )
  useEffect(() => {
    controller.activate()
    return () => controller.dispose()
  }, [controller])
  useEffect(() => {
    // Diff against last hydration plus flushed writes; never echo unchanged remote fields. Read baseline via getState so broadcasts cannot rerender/rearm this debounce.
    const armBaseline = useAppStore.getState().persistedUIWriteBaseline
    if (!persistedUIReady || !armBaseline) {
      return
    }
    if (Object.keys(diffPersistedUIWriteFields(ui, armBaseline)).length === 0) {
      return
    }
    const timer = window.setTimeout(() => {
      // Rediff at fire time for intervening broadcasts; baseline is not an effect dependency so remote traffic cannot starve the timer.
      const state = useAppStore.getState()
      const baseline = state.persistedUIWriteBaseline
      if (!baseline) {
        return
      }
      const changed = diffPersistedUIWriteFields(ui, baseline)
      if (Object.keys(changed).length === 0) {
        return
      }
      controller.send(changed)
    }, 150)

    return () => window.clearTimeout(timer)
  }, [controller, persistedUIReady, ui])

  // activeView uses a tiny profile preference rather than the multi-MB durable writer (#9002).
  useEffect(() => {
    if (!persistedUIReady) {
      return
    }
    void window.api.ui.set({ activeView })
  }, [activeView, persistedUIReady])
}
