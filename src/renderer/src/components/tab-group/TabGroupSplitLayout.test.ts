// @vitest-environment happy-dom
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import type { TabGroupLayoutNode } from '../../../../shared/tab-types'

const doubles = vi.hoisted(() => ({
  ratio: vi.fn(),
  record: vi.fn(),
  root: vi.fn(),
  panels: new Map<string, Record<string, unknown>>()
}))
vi.mock('../../store', () => ({
  useAppStore: {
    getState: () => ({
      setTabGroupSplitRatio: doubles.ratio,
      recordFeatureInteraction: doubles.record
    })
  }
}))
vi.mock('./TabGroupPanel', async () => {
  const { createElement } = await import('react')
  return {
    default: (props: { groupId: string } & Record<string, unknown>) => {
      doubles.panels.set(props.groupId, props)
      return createElement('div', { 'data-testid': props.groupId })
    }
  }
})
vi.mock('./WorkspaceTabDragLayer', () => ({
  WorkspaceTabDragLayer: ({
    children
  }: {
    children: (state: {
      isTabDragActive: boolean
      hoveredTabInsertion: null
      setDragRootNode: typeof doubles.root
    }) => unknown
  }) =>
    children({ isTabDragActive: false, hoveredTabInsertion: null, setDragRootNode: doubles.root })
}))
import TabGroupSplitLayout from './TabGroupSplitLayout'

beforeEach(() => {
  vi.clearAllMocks()
  doubles.panels.clear()
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
const leaf: TabGroupLayoutNode = { type: 'leaf', groupId: 'group-1' }
const pair: TabGroupLayoutNode = {
  type: 'split',
  direction: 'horizontal',
  ratio: 0.5,
  first: { type: 'leaf', groupId: 'left-group' },
  second: { type: 'leaf', groupId: 'right-group' }
}
function mount(layout: TabGroupLayoutNode, active = true) {
  return render(
    createElement(TabGroupSplitLayout, {
      layout,
      worktreeId: 'wt-1',
      focusedGroupId: layout.type === 'leaf' ? layout.groupId : 'right-group',
      isWorktreeActive: active
    })
  )
}
describe('TabGroupSplitLayout', () => {
  it('keeps an offscreen worktree mounted without keyboard focus', () => {
    mount(leaf, false)
    expect(doubles.panels.get('group-1')).toMatchObject({
      isVisible: false,
      isFocused: false,
      hasSplitGroups: false
    })
  })
  it('focuses the visible worktree group', () => {
    mount(leaf)
    expect(doubles.panels.get('group-1')).toMatchObject({
      isVisible: true,
      isFocused: true,
      reserveClosedExplorerToggleSpace: true,
      reserveCollapsedSidebarHeaderSpace: true
    })
  })
  it('wires the root to drag cleanup ownership', () => {
    mount(leaf)
    expect(doubles.root).toHaveBeenCalledWith(expect.any(HTMLElement))
  })
  it('reserves window controls only on the matching outer corner', () => {
    mount(pair)
    expect(doubles.panels.get('left-group')).toMatchObject({
      reserveClosedExplorerToggleSpace: false,
      reserveCollapsedSidebarHeaderSpace: true,
      showWorkspacePaneCloseButton: false
    })
    expect(doubles.panels.get('right-group')).toMatchObject({
      reserveClosedExplorerToggleSpace: true,
      reserveCollapsedSidebarHeaderSpace: false,
      showWorkspacePaneCloseButton: true
    })
  })
  it('records resizing when the actual divider gesture starts', () => {
    const view = mount(pair)
    const handle = view.container.querySelector<HTMLElement>('.tab-group-split-resize-handle')!
    Object.assign(handle, {
      setPointerCapture: vi.fn(),
      hasPointerCapture: () => false,
      releasePointerCapture: vi.fn()
    })
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 100, clientY: 0 })
    expect(doubles.record).toHaveBeenCalledWith('terminal-panes')
    expect(doubles.ratio).not.toHaveBeenCalled()
  })
})
