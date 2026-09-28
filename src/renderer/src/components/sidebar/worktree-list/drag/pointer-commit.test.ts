// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { commitWorktreePointerDrop } from './pointer-commit'
import type { WorktreeDropCommitContext } from './drop-commit-context'
import type { WorktreePointerDrag } from './row-state'

vi.mock('../../workspace-kanban-sidebar-drop', () => ({
  getWorkspaceKanbanSidebarDropGroups: () => [],
  getWorkspaceKanbanSidebarDropTarget: () => ({ status: null, isPinDrop: false }),
  isWorkspaceKanbanSidebarDropPointInBoard: () => false,
  resolveWorkspaceKanbanSidebarFullLaneDropIndex: (_status: string, index: number) => index
}))

vi.mock('../../workspace-kanban-card-pointer-drag-dom', () => ({
  resolveWorkspaceKanbanCardDropCommitTarget: () => ({ status: null, isPinDrop: false })
}))

afterEach(() => {
  vi.restoreAllMocks()
})

function setup() {
  const container = document.createElement('div')
  vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 240,
    bottom: 800,
    width: 240,
    height: 800,
    toJSON: () => ({})
  })
  const drag: WorktreePointerDrag = {
    pointerId: 1,
    sourceRow: document.createElement('div'),
    startX: 100,
    startY: 400,
    currentX: 100,
    currentY: 300,
    worktreeId: 'wt-1',
    draggedIds: ['wt-1'],
    reorderDraggedIds: ['wt-1'],
    reorderUnitDraggedIds: ['wt-1'],
    sourceGroupKey: 'workspace-status:in-progress',
    rects: [],
    active: true,
    preview: null,
    previewOffsetX: 0,
    previewOffsetY: 0,
    workspaceBoardDragPreviewRequested: false,
    frameId: null,
    reorderIntent: null,
    latestBoardDropTarget: null,
    latestStatusDropTarget: {
      target: { status: 'completed', isPinDrop: false, lineageParentId: null },
      preview: null,
      x: 100,
      y: 300
    }
  }
  const ctx: WorktreeDropCommitContext = {
    scrollRef: { current: container },
    workspaceStatuses: [],
    worktreeDragGroups: [],
    worktreeDragUnitGroups: [],
    refreshWorktreeDragSession: () => true,
    getEligibleLineageDropTarget: (target) => ({ ...target, lineageParentId: null }),
    computeWorktreeDrop: () => ({
      dropIndex: 2,
      dropIndicatorY: 300,
      dropAnchorId: null,
      previewOffsetsByWorktreeId: new Map()
    }),
    computeWorktreeStatusDrop: () => null,
    commitWorktreeLineageParentDrop: () => true,
    clearReorderedWorktreeParents: vi.fn(),
    clearWorktreeDrag: vi.fn(),
    onMoveWorktreesToStatus: vi.fn(),
    onMoveWorktreesToStatusAtIndex: vi.fn(),
    onReorderWorktrees: vi.fn(),
    onPinWorktrees: vi.fn()
  }
  const release = (clientX: number) =>
    commitWorktreePointerDrop({
      event: new PointerEvent('pointerup', { pointerId: 1, clientX, clientY: 300 }),
      drag,
      ctx,
      onWorkspaceBoardDragPreviewCommit: vi.fn(),
      onDropWorktreesOnWorkspaceBoard: vi.fn()
    })
  return { ctx, release }
}

describe('releasing a sidebar card drag', () => {
  it('cancels without reordering or moving status when released over the workspace area', () => {
    const { ctx, release } = setup()
    release(600)
    expect(ctx.onReorderWorktrees).not.toHaveBeenCalled()
    expect(ctx.onMoveWorktreesToStatus).not.toHaveBeenCalled()
    expect(ctx.onMoveWorktreesToStatusAtIndex).not.toHaveBeenCalled()
    expect(ctx.clearWorktreeDrag).toHaveBeenCalledOnce()
  })

  it('still reorders when released inside the sidebar', () => {
    const { ctx, release } = setup()
    release(100)
    expect(ctx.onReorderWorktrees).toHaveBeenCalledOnce()
    expect(ctx.clearWorktreeDrag).toHaveBeenCalledOnce()
  })
})
