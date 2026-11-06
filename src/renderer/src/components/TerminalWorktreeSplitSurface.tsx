import React from 'react'
import type { TabGroupLayoutNode } from '../../../shared/tab-types'
import type { ActivityTerminalPortalTarget } from './activity/activity-terminal-portal'
import {
  useBrowserGuestPaintRetention,
  useWorktreeBrowserPageIds
} from './browser-pane/host-guest/browser-guest-paint-retention'
import {
  shouldKeepHiddenWorktreeSurfacePaintable,
  shouldMountRetainedBrowserOverlay
} from './browser-pane/host-guest/browser-worktree-surface-paintability'
import TabGroupSplitLayout from './tab-group/TabGroupSplitLayout'
import { activateAndRevealWorkspace } from '@/lib/worktree-activation'
import type { WorkspaceSplitEdge } from '@/lib/workspace-split-layout'
import { useAppStore } from '@/store'
import { WorkspacePaneCloseButton } from './workspace-split/WorkspacePaneCloseButton'
import type { WorkspacePaneRect } from './workspace-split/WorkspaceSplitLayoutSlots'
import type { PositionedGroup } from './tab-group/TabGroupPositionedPanels'
import { WorkspacePaneOverlayLayers } from './WorkspacePaneOverlayLayers'
import type { TerminalPrewarmStage } from './terminal/terminal-worktree-prewarm'

export const WorktreeSplitSurface = React.memo(function WorktreeSplitSurface({
  worktreeId,
  worktreePath,
  layout,
  focusedGroupId,
  isVisible,
  isFocused = isVisible,
  paneRect,
  groupPositions,
  isMultiPane = false,
  reserveLeftWindowChrome = true,
  reserveRightWindowChrome = true,
  hoverEdge,
  hoverSwap,
  shouldMeasureHiddenWorktree,
  prewarmStage,
  shouldColdParkTerminalPanes,
  isForceParked,
  activityTerminalPortals,
  backgroundMountTabIds,
  activationDeferredMountTabIds
}: {
  worktreeId: string
  worktreePath: string
  layout: TabGroupLayoutNode | null
  focusedGroupId?: string
  isVisible: boolean
  isFocused?: boolean
  paneRect?: WorkspacePaneRect
  groupPositions?: ReadonlyMap<string, PositionedGroup>
  isMultiPane?: boolean
  reserveLeftWindowChrome?: boolean
  reserveRightWindowChrome?: boolean
  hoverEdge?: WorkspaceSplitEdge | null
  hoverSwap?: boolean
  shouldMeasureHiddenWorktree: boolean
  /** Hover intent: mount, then lay out, then render the revealable terminals while hidden. */
  prewarmStage: TerminalPrewarmStage | null
  shouldColdParkTerminalPanes: boolean
  isForceParked: boolean
  activityTerminalPortals: ActivityTerminalPortalTarget[]
  backgroundMountTabIds: ReadonlySet<string> | null
  activationDeferredMountTabIds: ReadonlySet<string> | null
}): React.JSX.Element {
  const browserPageIds = useWorktreeBrowserPageIds(worktreeId)
  const needsBrowserGuestPaint = useBrowserGuestPaintRetention(browserPageIds)
  const shouldKeepPaintable = shouldKeepHiddenWorktreeSurfacePaintable({
    // A mount-stage prewarm stays display:none so its style/layout cost lands in a later task.
    shouldMeasureHiddenWorktree: shouldMeasureHiddenWorktree && prewarmStage !== 'mount',
    needsBrowserGuestPaint
  })
  const isPaintVisible =
    isVisible && (!isMultiPane || paneRect !== undefined || groupPositions !== undefined)

  return (
    <div
      className={
        isPaintVisible
          ? groupPositions
            ? 'absolute inset-0 flex pointer-events-none'
            : 'absolute inset-0 flex'
          : shouldKeepPaintable
            ? 'absolute inset-0 flex opacity-0 pointer-events-none'
            : 'absolute inset-0 hidden'
      }
      style={
        isMultiPane && paneRect && !groupPositions
          ? {
              top: paneRect.top,
              left: paneRect.left,
              width: paneRect.width,
              height: paneRect.height,
              right: 'auto',
              bottom: 'auto'
            }
          : undefined
      }
      data-workspace-surface-id={worktreeId}
      inert={!isPaintVisible}
      aria-hidden={!isPaintVisible}
      onPointerDownCapture={() => {
        if (isPaintVisible && useAppStore.getState().activeWorktreeId !== worktreeId) {
          activateAndRevealWorkspace(worktreeId, { revealInSidebar: false })
        }
      }}
    >
      {hoverSwap ? (
        <div
          data-workspace-drop-swap="true"
          className="pointer-events-none absolute inset-0 z-50 border-2 border-primary bg-primary/15"
        />
      ) : null}
      {hoverEdge ? (
        <div
          data-workspace-drop-edge={hoverEdge}
          className={`pointer-events-none absolute z-50 border-2 border-primary bg-primary/15 ${
            hoverEdge === 'left'
              ? 'inset-y-0 left-0 w-1/2'
              : hoverEdge === 'right'
                ? 'inset-y-0 right-0 w-1/2'
                : hoverEdge === 'top'
                  ? 'inset-x-0 top-0 h-1/2'
                  : 'inset-x-0 bottom-0 h-1/2'
          }`}
        />
      ) : null}
      {layout ? (
        <TabGroupSplitLayout
          positions={groupPositions}
          layout={layout}
          worktreeId={worktreeId}
          focusedGroupId={focusedGroupId}
          isWorktreeActive={isVisible}
          isWorktreeFocused={isFocused}
          reserveLeftWindowChrome={reserveLeftWindowChrome}
          reserveRightWindowChrome={reserveRightWindowChrome}
        />
      ) : isVisible ? (
        <div
          className="flex flex-1 flex-col items-center justify-center gap-3 bg-background text-sm text-muted-foreground"
          data-workspace-empty-pane={worktreeId}
        >
          <span>{worktreePath.split(/[\\/]/).findLast(Boolean) ?? worktreePath}</span>
          <WorkspacePaneCloseButton worktreeId={worktreeId} />
          <button
            type="button"
            className="rounded border border-border bg-card px-3 py-1.5 text-foreground hover:bg-accent"
            onClick={() => useAppStore.getState().createTab(worktreeId)}
          >
            New terminal
          </button>
        </div>
      ) : null}
      <WorkspacePaneOverlayLayers
        worktreeId={worktreeId}
        worktreePath={worktreePath}
        isVisible={isVisible}
        isWorktreeFocused={isFocused}
        shouldMeasureHiddenWorktree={shouldMeasureHiddenWorktree}
        hiddenTerminalPrewarm={prewarmStage === 'mount' ? null : prewarmStage}
        shouldColdParkTerminalPanes={shouldColdParkTerminalPanes}
        isForceParked={isForceParked}
        activityTerminalPortals={activityTerminalPortals}
        backgroundMountTabIds={backgroundMountTabIds}
        activationDeferredMountTabIds={activationDeferredMountTabIds}
        mountRetainedBrowserOverlay={shouldMountRetainedBrowserOverlay({
          isWorktreeVisible: isVisible,
          hasDeferredBackgroundMounts: backgroundMountTabIds !== null,
          needsBrowserGuestPaint
        })}
        mountEmulatorOverlay={isVisible || backgroundMountTabIds === null}
      />
    </div>
  )
})
