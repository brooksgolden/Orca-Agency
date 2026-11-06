// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { workspaceSurfaceDropTarget } from './workspace-surface-drop-target'
import { isLocalTabDrop } from './workspace-local-tab-drop'
import { createTestStore, makeWorktree, seedStore } from '@/store/slices/store-test-helpers'
import { createTabsSliceMockApi } from '@/store/slices/tabs-slice-test-harness'
import { workspacePaneBounds, workspacePaneKey } from '@/lib/workspace-group-layout'

const mocked = vi.hoisted(() => ({ getState: vi.fn() }))
vi.mock('@/store', () => ({ useAppStore: { getState: mocked.getState } }))
vi.mock('sonner', () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() } }))
createTabsSliceMockApi()
let store: ReturnType<typeof createTestStore>
let root: HTMLDivElement
let surface: HTMLDivElement
let panel: HTMLDivElement
let group: string
const rect = (left: number, top: number, width: number, height: number) =>
  new DOMRect(left, top, width, height)
beforeEach(() => {
  store = createTestStore()
  seedStore(store, {
    worktreesByRepo: {
      repo1: ['a', 'b', 'c', 'd'].map((id) =>
        makeWorktree({ id, repoId: 'repo1', hostId: 'local' })
      )
    }
  })
  for (const id of ['a', 'b', 'c', 'd']) {
    store.getState().createTab(id)
  }
  store.getState().placeWorkspaceAtEdge('b', 'a', 'right')
  store.getState().placeWorkspaceAtEdge('c', 'b', 'right')
  store.getState().placeWorkspaceAtEdge('d', 'c', 'right')
  mocked.getState.mockImplementation(() => store.getState())
  root = document.createElement('div')
  surface = document.createElement('div')
  panel = document.createElement('div')
  root.append(surface)
  surface.append(panel)
  document.body.append(root)
  surface.dataset.workspaceSurfaceId = 'd'
  group = store.getState().groupsByWorktree.d[0].id
  panel.dataset.workspacePaneGroupId = group
  root.getBoundingClientRect = () => rect(0, 0, 1000, 800)
  surface.getBoundingClientRect = () => rect(750, 0, 250, 800)
  panel.getBoundingClientRect = () => rect(750, 0, 250, 800)
  vi.spyOn(document, 'elementFromPoint').mockReturnValue(panel)
})
afterEach(() => {
  root.remove()
  vi.restoreAllMocks()
})
it('hits the full-height slot including its 4px header, and commits the shown quadrant', () => {
  // Actual panel content starts below its drag strip; the addressed slot spans the full root.
  const content = document.createElement('div')
  panel.append(content)
  content.getBoundingClientRect = () => rect(750, 4, 250, 796)
  vi.mocked(document.elementFromPoint).mockReturnValue(content)
  const target = workspaceSurfaceDropTarget(
    root,
    new Set(['a', 'b', 'c', 'd']),
    surface,
    990,
    790,
    'd',
    undefined,
    group
  )
  expect(target.blocked).toBe(false)
  expect(target.placement).toEqual({ kind: 'quadrant', quadrant: 'bottom-right' })
  expect(target.previewBounds).toMatchObject({ top: 400, height: 400 })
  expect(
    store
      .getState()
      .placeWorkspaceSurface(
        { type: 'leaf', workspaceId: 'd', groupId: group },
        { type: 'leaf', workspaceId: 'd', groupId: target.targetGroupId },
        target.edge,
        { placement: target.placement }
      )
  ).toBe(true)
  const layout = store.getState().workspaceSplitGroups[0].layout
  const bounds = workspacePaneBounds(
    layout,
    workspacePaneKey({ type: 'leaf', workspaceId: 'd', groupId: group })
  )!
  expect(target.previewBounds).toEqual({
    left: bounds.left * 1000,
    top: bounds.top * 800,
    width: bounds.width * 1000,
    height: bounds.height * 800
  })
})
it('accepts a mounted synthetic layout and leaves same-owner center joins local', () => {
  const state = store.getState()
  store.setState({
    layoutByWorktree: Object.fromEntries(
      Object.entries(state.layoutByWorktree).filter(([id]) => id !== 'd')
    )
  })
  const target = workspaceSurfaceDropTarget(
    root,
    new Set(['a', 'b', 'c', 'd']),
    surface,
    875,
    400,
    'c',
    undefined,
    state.groupsByWorktree.c[0].id
  )
  expect(target.blocked).toBe(false)
  expect(target.targetGroupId).toBe(group)
  expect(isLocalTabDrop({ ...target, id: 'd' }, 'd', 875, 400)).toBe(true)
})
