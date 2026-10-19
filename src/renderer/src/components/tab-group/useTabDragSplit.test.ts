/**
 * @vitest-environment happy-dom
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Tab, TabGroup, TabGroupLayoutNode } from '../../../../shared/tab-types'
import { useAppStore } from '../../store'
import type { TabDragItemData } from './useTabDragSplit'
import { shouldActivateTabDragFromDistanceSample } from './tab-drag-pointer-sensor'
import {
  canDropTabForPaneColumnSplit,
  canDropTabIntoPaneBody,
  getTabDragActivationDistance,
  TAB_DRAG_ACTIVATION_DISTANCE_PX,
  useTabDragSplit
} from './useTabDragSplit'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../browser-pane/host-guest/webview-registry', () => ({
  acquireWebviewsDragPassthrough: vi.fn(() => vi.fn())
}))

vi.mock('../../runtime/web-runtime-session', () => ({
  isWebRuntimeSessionActive: vi.fn(() => false),
  moveWebRuntimeSessionTab: vi.fn()
}))

const WT = 'wt-1'
const mounted: { container: HTMLDivElement; root: Root }[] = []
const originalReorderUnifiedTabs = useAppStore.getState().reorderUnifiedTabs
const originalDropUnifiedTab = useAppStore.getState().dropUnifiedTab

function makeGroup(id: string, tabOrder: string[]): TabGroup {
  return {
    id,
    worktreeId: WT,
    activeTabId: tabOrder[0] ?? null,
    tabOrder
  }
}

function makeDragData(groupId: string, unifiedTabId = 'tab-1'): TabDragItemData {
  return {
    kind: 'tab',
    worktreeId: WT,
    groupId,
    unifiedTabId,
    visibleTabId: unifiedTabId,
    tabType: 'editor',
    label: unifiedTabId
  }
}

function rect({
  left,
  top,
  width,
  height
}: {
  left: number
  top: number
  width: number
  height: number
}): DOMRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height
  } as DOMRect
}

function addPanelGeometry(groupId: string, panelRect: DOMRect, bodyRect: DOMRect): HTMLElement {
  const panel = document.createElement('div')
  const strip = document.createElement('div')
  const body = document.createElement('div')
  strip.dataset.tabGroupStripId = groupId
  strip.dataset.worktreeId = WT
  strip.getBoundingClientRect = () =>
    rect({ left: panelRect.left, top: panelRect.top, width: panelRect.width, height: 32 })
  body.dataset.tabGroupBodyId = groupId
  body.dataset.worktreeId = WT
  panel.getBoundingClientRect = () => panelRect
  body.getBoundingClientRect = () => bodyRect
  panel.appendChild(strip)
  panel.appendChild(body)
  document.body.appendChild(panel)
  return panel
}

function addStripTab(
  panel: HTMLElement,
  visibleTabId: string,
  unifiedTabId: string,
  tabRect: DOMRect
): void {
  const tab = document.createElement('div')
  tab.dataset.tabId = visibleTabId
  tab.dataset.unifiedTabId = unifiedTabId
  tab.getBoundingClientRect = () => tabRect
  panel.querySelector('[data-tab-group-strip-id]')?.appendChild(tab)
}

function makeDragEvent(activeData: TabDragItemData, pointer: { x: number; y: number }) {
  return {
    active: {
      data: { current: activeData },
      rect: { current: { initial: null } }
    },
    over: null,
    delta: { x: 0, y: 0 },
    activatorEvent: { clientX: pointer.x, clientY: pointer.y }
  }
}

function renderDragHook(
  onRender?: (drag: ReturnType<typeof useTabDragSplit>) => void
): ReturnType<typeof useTabDragSplit> {
  let result: ReturnType<typeof useTabDragSplit> | null = null
  function Probe(): null {
    result = useTabDragSplit({ worktreeId: WT })
    onRender?.(result)
    return null
  }

  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => root.render(createElement(Probe)))
  mounted.push({ container, root })
  if (!result) {
    throw new Error('useTabDragSplit did not render')
  }
  return result
}

beforeEach(() => {
  useAppStore.setState({
    reorderUnifiedTabs: originalReorderUnifiedTabs,
    dropUnifiedTab: originalDropUnifiedTab,
    activeWorktreeId: WT,
    activeGroupIdByWorktree: { [WT]: 'group-1' },
    groupsByWorktree: {
      [WT]: [makeGroup('group-1', ['tab-1', 'tab-3']), makeGroup('group-2', ['tab-2'])]
    },
    unifiedTabsByWorktree: {
      [WT]: [
        {
          id: 'tab-1',
          groupId: 'group-1',
          worktreeId: WT,
          contentType: 'terminal',
          entityId: 'term-1',
          label: 'one',
          customLabel: null,
          color: null,
          sortOrder: 0,
          createdAt: 0
        } satisfies Tab,
        {
          id: 'tab-2',
          groupId: 'group-2',
          worktreeId: WT,
          contentType: 'terminal',
          entityId: 'term-2',
          label: 'two',
          customLabel: null,
          color: null,
          sortOrder: 1,
          createdAt: 1
        } satisfies Tab,
        {
          id: 'tab-3',
          groupId: 'group-1',
          worktreeId: WT,
          contentType: 'terminal',
          entityId: 'term-3',
          label: 'three',
          customLabel: null,
          color: null,
          sortOrder: 2,
          createdAt: 2
        } satisfies Tab
      ]
    },
    layoutByWorktree: {
      [WT]: {
        type: 'split',
        direction: 'horizontal',
        ratio: 0.5,
        first: { type: 'leaf', groupId: 'group-1' },
        second: { type: 'leaf', groupId: 'group-2' }
      } satisfies TabGroupLayoutNode
    }
  })
})

afterEach(() => {
  for (const { container, root } of mounted.splice(0)) {
    act(() => root.unmount())
    container.remove()
  }
  document.body.replaceChildren()
  vi.clearAllMocks()
})

describe('tab drag activation distance', () => {
  it('uses the named threshold for enabled tab drags', () => {
    expect(getTabDragActivationDistance(true)).toBe(TAB_DRAG_ACTIVATION_DISTANCE_PX)
  })

  it('keeps enabled tab drags above the old overly-sensitive distance', () => {
    expect(TAB_DRAG_ACTIVATION_DISTANCE_PX).toBeGreaterThan(5)
  })

  it('uses an impossible activation distance when tab dragging is disabled', () => {
    expect(getTabDragActivationDistance(false)).toBe(Number.MAX_SAFE_INTEGER)
  })

  it('requires confirmation for an immediate over-threshold distance sample', () => {
    expect(
      shouldActivateTabDragFromDistanceSample({
        elapsedMs: 10,
        overThresholdSampleCount: 1
      })
    ).toBe(false)
    expect(
      shouldActivateTabDragFromDistanceSample({
        elapsedMs: 10,
        overThresholdSampleCount: 2
      })
    ).toBe(true)
    expect(
      shouldActivateTabDragFromDistanceSample({
        elapsedMs: 60,
        overThresholdSampleCount: 1
      })
    ).toBe(true)
  })
})

describe('canDropTabIntoPaneBody', () => {
  it('rejects pane-body drops that would split a single tab onto itself', () => {
    expect(
      canDropTabIntoPaneBody({
        activeDrag: makeDragData('group-1'),
        groupsByWorktree: { [WT]: [makeGroup('group-1', ['tab-1'])] },
        overGroupId: 'group-1',
        worktreeId: WT
      })
    ).toBe(false)
  })

  it('allows same-group pane-body drops when the group still has other tabs', () => {
    expect(
      canDropTabIntoPaneBody({
        activeDrag: makeDragData('group-1'),
        groupsByWorktree: { [WT]: [makeGroup('group-1', ['tab-1', 'tab-2'])] },
        overGroupId: 'group-1',
        worktreeId: WT
      })
    ).toBe(true)
  })

  it('allows pane-body drops into a different group', () => {
    expect(
      canDropTabIntoPaneBody({
        activeDrag: makeDragData('group-1'),
        groupsByWorktree: {
          [WT]: [makeGroup('group-1', ['tab-1']), makeGroup('group-2', ['tab-2'])]
        },
        overGroupId: 'group-2',
        worktreeId: WT
      })
    ).toBe(true)
  })

  it('rejects tab-on-tab split drops across groups', () => {
    expect(
      canDropTabForPaneColumnSplit({
        activeDrag: makeDragData('group-1'),
        groupsByWorktree: {
          [WT]: [makeGroup('group-1', ['tab-1']), makeGroup('group-2', ['tab-2'])]
        },
        targetGroupId: 'group-2',
        worktreeId: WT
      })
    ).toBe(false)
  })
})

describe('useTabDragSplit', () => {
  it('keeps the drag sensors across re-renders until enablement changes', () => {
    const sensorsByRender: ReturnType<typeof useTabDragSplit>['sensors'][] = []
    function Probe({ enabled }: { enabled: boolean }): null {
      sensorsByRender.push(useTabDragSplit({ worktreeId: WT, enabled }).sensors)
      return null
    }
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    mounted.push({ container, root })

    act(() => root.render(createElement(Probe, { enabled: true })))
    act(() => root.render(createElement(Probe, { enabled: true })))
    // Why: new sensors rebuild every tab's drag listeners, which re-renders every tab.
    expect(sensorsByRender.at(-1)).toBe(sensorsByRender.at(-2))

    act(() => root.render(createElement(Probe, { enabled: false })))
    expect(sensorsByRender.at(-1)).not.toBe(sensorsByRender.at(-2))
  })

  it.each(['split', 'insertion'])(
    'does not restore a %s preview after blur cleared the drag',
    async (preview) => {
      addPanelGeometry(
        'group-2',
        rect({ left: 500, top: 0, width: 400, height: 600 }),
        rect({ left: 500, top: 32, width: 400, height: 568 })
      )
      const onRender = vi.fn()
      const drag = renderDragHook(onRender)
      const event = {
        ...makeDragEvent(makeDragData('group-1'), {
          x: 880,
          y: preview === 'split' ? 300 : 16
        }),
        ...(preview === 'insertion'
          ? {
              over: {
                data: { current: makeDragData('group-2', 'tab-2') },
                rect: rect({ left: 500, top: 0, width: 400, height: 32 })
              }
            }
          : {})
      }
      const previewKey = preview === 'split' ? 'hoveredDropTarget' : 'hoveredTabInsertion'
      act(() => drag.onDragStart(event as unknown as Parameters<typeof drag.onDragStart>[0]))
      act(() => drag.onDragMove(event as unknown as Parameters<typeof drag.onDragMove>[0]))
      expect(onRender.mock.lastCall?.[0][previewKey]).not.toBeNull()

      await act(async () => {
        window.dispatchEvent(new Event('blur'))
        await new Promise((resolve) => window.setTimeout(resolve, 0))
      })
      expect(onRender.mock.lastCall?.[0][previewKey]).toBeNull()
      act(() => drag.onDragMove(event as unknown as Parameters<typeof drag.onDragMove>[0]))

      expect(onRender.mock.lastCall?.[0][previewKey]).toBeNull()
      expect(drag.isTabDragActiveRef.current).toBe(false)
    }
  )

  it('does not commit a drop after blur cleared the drag', async () => {
    addPanelGeometry(
      'group-2',
      rect({ left: 500, top: 0, width: 400, height: 600 }),
      rect({ left: 500, top: 32, width: 400, height: 568 })
    )
    const dropUnifiedTab = vi.fn(() => true)
    const reorderUnifiedTabs = vi.fn()
    useAppStore.setState({ dropUnifiedTab, reorderUnifiedTabs })
    const drag = renderDragHook()
    const event = makeDragEvent(makeDragData('group-1'), { x: 880, y: 300 })
    act(() => drag.onDragStart(event as unknown as Parameters<typeof drag.onDragStart>[0]))
    await act(async () => {
      window.dispatchEvent(new Event('blur'))
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })
    act(() => drag.onDragEnd(event as unknown as Parameters<typeof drag.onDragEnd>[0]))

    expect(dropUnifiedTab).not.toHaveBeenCalled()
    expect(reorderUnifiedTabs).not.toHaveBeenCalled()
  })

  it.each(['pointerup', 'pointercancel', 'blur', 'focus'])(
    'clears a stuck active drag when %s arrives without a dnd end event',
    async (eventName) => {
      const activeData = makeDragData('group-1')
      const drag = renderDragHook()

      act(() => {
        drag.onDragStart(
          makeDragEvent(activeData, { x: 120, y: 20 }) as unknown as Parameters<
            typeof drag.onDragStart
          >[0]
        )
        // Why: dispatch in the same turn as drag start so the fallback must be
        // installed synchronously, before React can run passive effects.
        window.dispatchEvent(new MouseEvent(eventName, { bubbles: true }))
      })
      expect(drag.isTabDragActiveRef.current).toBe(true)

      await act(async () => {
        await new Promise((resolve) => window.setTimeout(resolve, 0))
      })

      expect(drag.isTabDragActiveRef.current).toBe(false)
    }
  )

  it('does not cancel a legitimate drag end when the fallback timer is pending', async () => {
    addPanelGeometry(
      'group-2',
      rect({ left: 500, top: 0, width: 400, height: 600 }),
      rect({ left: 500, top: 32, width: 400, height: 568 })
    )
    const activeData = makeDragData('group-1')
    const dropUnifiedTab = vi.fn(() => true)
    useAppStore.setState({ dropUnifiedTab } as Partial<ReturnType<typeof useAppStore.getState>>)

    const drag = renderDragHook()

    act(() => {
      drag.onDragStart(
        makeDragEvent(activeData, { x: 120, y: 20 }) as unknown as Parameters<
          typeof drag.onDragStart
        >[0]
      )
      window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }))
      drag.onDragEnd(
        makeDragEvent(activeData, { x: 880, y: 300 }) as unknown as Parameters<
          typeof drag.onDragEnd
        >[0]
      )
    })
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })

    expect(drag.isTabDragActiveRef.current).toBe(false)
    expect(dropUnifiedTab).toHaveBeenCalledWith('tab-1', {
      groupId: 'group-2',
      splitDirection: 'right'
    })
  })

  it('commits the visible insertion marker when pointerup loses the hovered tab', () => {
    const panel = addPanelGeometry(
      'group-1',
      rect({ left: 0, top: 0, width: 400, height: 600 }),
      rect({ left: 0, top: 32, width: 400, height: 568 })
    )
    addStripTab(
      panel,
      'editor-file-1',
      'tab-1',
      rect({ left: 100, top: 0, width: 100, height: 32 })
    )
    const onRender = vi.fn()
    const drag = renderDragHook(onRender)
    const activeData = makeDragData('group-1', 'tab-3')
    const moveEvent = {
      ...makeDragEvent(activeData, { x: 120, y: 16 }),
      over: {
        data: {
          current: { ...makeDragData('group-1', 'tab-1'), visibleTabId: 'editor-file-1' }
        },
        rect: rect({ left: 100, top: 0, width: 100, height: 32 })
      }
    }
    act(() => drag.onDragStart(moveEvent as unknown as Parameters<typeof drag.onDragStart>[0]))
    act(() => drag.onDragMove(moveEvent as unknown as Parameters<typeof drag.onDragMove>[0]))
    expect(onRender.mock.lastCall?.[0].hoveredTabInsertion).toEqual({
      groupId: 'group-1',
      unifiedTabId: 'tab-1',
      visibleTabId: 'editor-file-1',
      side: 'left'
    })

    act(() =>
      drag.onDragEnd(
        makeDragEvent(activeData, { x: 120, y: 16 }) as unknown as Parameters<
          typeof drag.onDragEnd
        >[0]
      )
    )
    expect(useAppStore.getState().groupsByWorktree[WT]?.[0]?.tabOrder).toEqual(['tab-3', 'tab-1'])
  })

  it('does not commit an old insertion marker after the pointer leaves the tab strip', () => {
    addPanelGeometry(
      'group-1',
      rect({ left: 0, top: 0, width: 400, height: 600 }),
      rect({ left: 0, top: 32, width: 400, height: 568 })
    )
    const drag = renderDragHook()
    const activeData = makeDragData('group-1', 'tab-3')
    const moveEvent = {
      ...makeDragEvent(activeData, { x: 120, y: 16 }),
      over: {
        data: { current: makeDragData('group-1', 'tab-1') },
        rect: rect({ left: 100, top: 0, width: 100, height: 32 })
      }
    }
    act(() => drag.onDragStart(moveEvent as unknown as Parameters<typeof drag.onDragStart>[0]))
    act(() => drag.onDragMove(moveEvent as unknown as Parameters<typeof drag.onDragMove>[0]))
    act(() =>
      drag.onDragEnd(
        makeDragEvent(activeData, { x: 120, y: 300 }) as unknown as Parameters<
          typeof drag.onDragEnd
        >[0]
      )
    )
    expect(useAppStore.getState().groupsByWorktree[WT]?.[0]?.tabOrder).toEqual(['tab-1', 'tab-3'])
  })

  it('shows an append marker on a blank strip and commits that same reorder', () => {
    const panel = addPanelGeometry(
      'group-1',
      rect({ left: 0, top: 0, width: 400, height: 600 }),
      rect({ left: 0, top: 32, width: 400, height: 568 })
    )
    addStripTab(panel, 'tab-1', 'tab-1', rect({ left: 0, top: 0, width: 100, height: 32 }))
    addStripTab(panel, 'tab-3', 'tab-3', rect({ left: 100, top: 0, width: 100, height: 32 }))
    const onRender = vi.fn()
    const drag = renderDragHook(onRender)
    const activeData = makeDragData('group-1', 'tab-1')
    const event = {
      ...makeDragEvent(activeData, { x: 390, y: 16 }),
      over: { data: { current: { kind: 'pane-body', worktreeId: WT, groupId: 'group-1' } } }
    }
    act(() => drag.onDragStart(event as unknown as Parameters<typeof drag.onDragStart>[0]))
    act(() => drag.onDragMove(event as unknown as Parameters<typeof drag.onDragMove>[0]))
    expect(onRender.mock.lastCall?.[0].hoveredDropTarget).toBeNull()
    expect(onRender.mock.lastCall?.[0].hoveredTabInsertion).toEqual({
      groupId: 'group-1',
      unifiedTabId: 'tab-3',
      visibleTabId: 'tab-3',
      side: 'right'
    })
    act(() => drag.onDragEnd(event as unknown as Parameters<typeof drag.onDragEnd>[0]))
    expect(useAppStore.getState().groupsByWorktree[WT]?.[0]?.tabOrder).toEqual(['tab-3', 'tab-1'])
  })

  it('shows an insert-before marker in blank space before the first tab', () => {
    const panel = addPanelGeometry(
      'group-1',
      rect({ left: 0, top: 0, width: 400, height: 600 }),
      rect({ left: 0, top: 32, width: 400, height: 568 })
    )
    addStripTab(panel, 'tab-1', 'tab-1', rect({ left: 100, top: 0, width: 100, height: 32 }))
    addStripTab(panel, 'tab-3', 'tab-3', rect({ left: 220, top: 0, width: 100, height: 32 }))
    const onRender = vi.fn()
    const drag = renderDragHook(onRender)
    const activeData = makeDragData('group-1', 'tab-3')
    const event = makeDragEvent(activeData, { x: 50, y: 16 })
    act(() => drag.onDragStart(event as unknown as Parameters<typeof drag.onDragStart>[0]))
    act(() => drag.onDragMove(event as unknown as Parameters<typeof drag.onDragMove>[0]))
    expect(onRender.mock.lastCall?.[0].hoveredTabInsertion).toEqual({
      groupId: 'group-1',
      unifiedTabId: 'tab-1',
      visibleTabId: 'tab-1',
      side: 'left'
    })
    act(() => drag.onDragEnd(event as unknown as Parameters<typeof drag.onDragEnd>[0]))
    expect(useAppStore.getState().groupsByWorktree[WT]?.[0]?.tabOrder).toEqual(['tab-3', 'tab-1'])
  })

  it('does not append the dragged first tab when released in blank space before itself', () => {
    const panel = addPanelGeometry(
      'group-1',
      rect({ left: 0, top: 0, width: 400, height: 600 }),
      rect({ left: 0, top: 32, width: 400, height: 568 })
    )
    addStripTab(panel, 'tab-1', 'tab-1', rect({ left: 100, top: 0, width: 100, height: 32 }))
    addStripTab(panel, 'tab-3', 'tab-3', rect({ left: 220, top: 0, width: 100, height: 32 }))
    const onRender = vi.fn()
    const drag = renderDragHook(onRender)
    const event = makeDragEvent(makeDragData('group-1', 'tab-1'), { x: 50, y: 16 })
    act(() => drag.onDragStart(event as unknown as Parameters<typeof drag.onDragStart>[0]))
    act(() => drag.onDragMove(event as unknown as Parameters<typeof drag.onDragMove>[0]))
    expect(onRender.mock.lastCall?.[0].hoveredTabInsertion).toBeNull()
    act(() => drag.onDragEnd(event as unknown as Parameters<typeof drag.onDragEnd>[0]))
    expect(useAppStore.getState().groupsByWorktree[WT]?.[0]?.tabOrder).toEqual(['tab-1', 'tab-3'])
  })

  it('ignores tabs clipped outside the scroll viewport when choosing an insertion target', () => {
    const panel = addPanelGeometry(
      'group-1',
      rect({ left: 0, top: 0, width: 400, height: 600 }),
      rect({ left: 0, top: 32, width: 400, height: 568 })
    )
    addStripTab(panel, 'tab-1', 'tab-1', rect({ left: 0, top: 0, width: 100, height: 32 }))
    addStripTab(panel, 'tab-3', 'tab-3', rect({ left: 300, top: 0, width: 100, height: 32 }))
    const strip = panel.querySelector('[data-tab-group-strip-id]')
    const scroller = document.createElement('div')
    scroller.className = 'terminal-tab-strip'
    scroller.getBoundingClientRect = () => rect({ left: 0, top: 0, width: 200, height: 32 })
    while (strip?.firstChild) {
      scroller.appendChild(strip.firstChild)
    }
    strip?.appendChild(scroller)
    const onRender = vi.fn()
    const drag = renderDragHook(onRender)
    const event = makeDragEvent(makeDragData('group-1', 'tab-1'), { x: 350, y: 16 })
    act(() => drag.onDragStart(event as unknown as Parameters<typeof drag.onDragStart>[0]))
    act(() => drag.onDragMove(event as unknown as Parameters<typeof drag.onDragMove>[0]))
    expect(onRender.mock.lastCall?.[0].hoveredTabInsertion).toBeNull()
    act(() => drag.onDragEnd(event as unknown as Parameters<typeof drag.onDragEnd>[0]))
    expect(useAppStore.getState().groupsByWorktree[WT]?.[0]?.tabOrder).toEqual(['tab-1', 'tab-3'])
  })

  it('shows no insertion marker when the pointer is outside all panes', () => {
    const panel = addPanelGeometry(
      'group-1',
      rect({ left: 0, top: 0, width: 400, height: 600 }),
      rect({ left: 0, top: 32, width: 400, height: 568 })
    )
    addStripTab(panel, 'tab-3', 'tab-3', rect({ left: 100, top: 0, width: 100, height: 32 }))
    const onRender = vi.fn()
    const drag = renderDragHook(onRender)
    const activeData = makeDragData('group-1', 'tab-1')
    const event = {
      ...makeDragEvent(activeData, { x: 450, y: 16 }),
      over: {
        data: { current: makeDragData('group-1', 'tab-3') },
        rect: rect({ left: 100, top: 0, width: 100, height: 32 })
      }
    }
    act(() => drag.onDragStart(event as unknown as Parameters<typeof drag.onDragStart>[0]))
    act(() => drag.onDragMove(event as unknown as Parameters<typeof drag.onDragMove>[0]))
    expect(onRender.mock.lastCall?.[0].hoveredTabInsertion).toBeNull()
    expect(onRender.mock.lastCall?.[0].hoveredDropTarget).toBeNull()
    act(() => drag.onDragEnd(event as unknown as Parameters<typeof drag.onDragEnd>[0]))
    expect(useAppStore.getState().groupsByWorktree[WT]?.[0]?.tabOrder).toEqual(['tab-1', 'tab-3'])
  })

  it('keeps source focus when dnd-kit reports another pane outside all panes', () => {
    addPanelGeometry(
      'group-1',
      rect({ left: 0, top: 0, width: 400, height: 600 }),
      rect({ left: 0, top: 32, width: 400, height: 568 })
    )
    const drag = renderDragHook()
    const activeData = makeDragData('group-1')
    const event = {
      ...makeDragEvent(activeData, { x: 450, y: 16 }),
      over: { data: { current: { kind: 'pane-body', worktreeId: WT, groupId: 'group-2' } } }
    }
    act(() => drag.onDragStart(event as unknown as Parameters<typeof drag.onDragStart>[0]))
    act(() => drag.onDragMove(event as unknown as Parameters<typeof drag.onDragMove>[0]))
    expect(useAppStore.getState().activeGroupIdByWorktree[WT]).toBe('group-1')
  })

  it('drops into the pane under the pointer when dnd-kit reports another group', () => {
    addPanelGeometry(
      'group-2',
      rect({ left: 500, top: 0, width: 400, height: 600 }),
      rect({ left: 500, top: 32, width: 400, height: 568 })
    )
    const dropUnifiedTab = vi.fn(() => true)
    useAppStore.setState({ dropUnifiedTab } as Partial<ReturnType<typeof useAppStore.getState>>)
    const drag = renderDragHook()
    const activeData = makeDragData('group-1')
    const event = {
      ...makeDragEvent(activeData, { x: 700, y: 300 }),
      over: { data: { current: { kind: 'pane-body', worktreeId: WT, groupId: 'group-1' } } }
    }
    act(() => drag.onDragStart(event as unknown as Parameters<typeof drag.onDragStart>[0]))
    act(() => drag.onDragMove(event as unknown as Parameters<typeof drag.onDragMove>[0]))
    expect(useAppStore.getState().activeGroupIdByWorktree[WT]).toBe('group-2')
    act(() => drag.onDragEnd(event as unknown as Parameters<typeof drag.onDragEnd>[0]))
    expect(dropUnifiedTab).toHaveBeenCalledWith('tab-1', { groupId: 'group-2' })
  })

  it('appends to the strip under the pointer instead of another pane selected by dnd-kit', () => {
    addPanelGeometry(
      'group-2',
      rect({ left: 500, top: 0, width: 400, height: 600 }),
      rect({ left: 500, top: 32, width: 400, height: 568 })
    )
    const dropUnifiedTab = vi.fn(() => true)
    useAppStore.setState({ dropUnifiedTab } as Partial<ReturnType<typeof useAppStore.getState>>)
    const drag = renderDragHook()
    const activeData = makeDragData('group-1', 'tab-3')
    const event = {
      ...makeDragEvent(activeData, { x: 760, y: 16 }),
      over: {
        data: { current: makeDragData('group-1', 'tab-1') },
        rect: rect({ left: 100, top: 0, width: 100, height: 32 })
      }
    }
    act(() => drag.onDragStart(event as unknown as Parameters<typeof drag.onDragStart>[0]))
    act(() => drag.onDragEnd(event as unknown as Parameters<typeof drag.onDragEnd>[0]))

    expect(dropUnifiedTab).toHaveBeenCalledWith('tab-3', { groupId: 'group-2', index: 1 })
  })

  it('does not split or move a tab when release over itself loses the target', () => {
    const panel = addPanelGeometry(
      'group-1',
      rect({ left: 0, top: 0, width: 400, height: 600 }),
      rect({ left: 0, top: 32, width: 400, height: 568 })
    )
    addStripTab(panel, 'tab-1', 'tab-1', rect({ left: 0, top: 0, width: 100, height: 32 }))
    const dropUnifiedTab = vi.fn(() => true)
    const reorderUnifiedTabs = vi.fn()
    useAppStore.setState({ dropUnifiedTab, reorderUnifiedTabs })
    const drag = renderDragHook()
    const event = makeDragEvent(makeDragData('group-1'), { x: 5, y: 16 })
    act(() => drag.onDragStart(event as unknown as Parameters<typeof drag.onDragStart>[0]))
    act(() => drag.onDragEnd(event as unknown as Parameters<typeof drag.onDragEnd>[0]))

    expect(dropUnifiedTab).not.toHaveBeenCalled()
    expect(reorderUnifiedTabs).not.toHaveBeenCalled()
  })

  it('does not move a tab when released over a control in another strip', () => {
    const panel = addPanelGeometry(
      'group-2',
      rect({ left: 500, top: 0, width: 400, height: 600 }),
      rect({ left: 500, top: 32, width: 400, height: 568 })
    )
    const button = document.createElement('button')
    panel.querySelector('[data-tab-group-strip-id]')?.appendChild(button)
    const previous = Object.getOwnPropertyDescriptor(document, 'elementFromPoint')
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: () => button
    })
    try {
      const dropUnifiedTab = vi.fn(() => true)
      useAppStore.setState({ dropUnifiedTab } as Partial<ReturnType<typeof useAppStore.getState>>)
      const drag = renderDragHook()
      const event = makeDragEvent(makeDragData('group-1'), { x: 760, y: 16 })
      act(() => drag.onDragStart(event as unknown as Parameters<typeof drag.onDragStart>[0]))
      act(() => drag.onDragMove(event as unknown as Parameters<typeof drag.onDragMove>[0]))
      expect(useAppStore.getState().activeGroupIdByWorktree[WT]).toBe('group-1')
      act(() => drag.onDragEnd(event as unknown as Parameters<typeof drag.onDragEnd>[0]))
      expect(dropUnifiedTab).not.toHaveBeenCalled()
    } finally {
      if (previous) {
        Object.defineProperty(document, 'elementFromPoint', previous)
      } else {
        Reflect.deleteProperty(document, 'elementFromPoint')
      }
    }
  })

  it.each([
    { activeTabId: 'tab-1', pointerX: 120 },
    { activeTabId: 'tab-3', pointerX: 80 }
  ])('shows no insertion line for an unchanged adjacent slot', ({ activeTabId, pointerX }) => {
    const panel = addPanelGeometry(
      'group-1',
      rect({ left: 0, top: 0, width: 400, height: 600 }),
      rect({ left: 0, top: 32, width: 400, height: 568 })
    )
    addStripTab(panel, 'tab-1', 'tab-1', rect({ left: 0, top: 0, width: 100, height: 32 }))
    addStripTab(panel, 'tab-3', 'tab-3', rect({ left: 100, top: 0, width: 100, height: 32 }))
    const reorderUnifiedTabs = vi.fn()
    useAppStore.setState({ reorderUnifiedTabs } as Partial<ReturnType<typeof useAppStore.getState>>)
    const onRender = vi.fn()
    const drag = renderDragHook(onRender)
    const event = makeDragEvent(makeDragData('group-1', activeTabId), {
      x: pointerX,
      y: 16
    })
    act(() => drag.onDragStart(event as unknown as Parameters<typeof drag.onDragStart>[0]))
    act(() => drag.onDragMove(event as unknown as Parameters<typeof drag.onDragMove>[0]))
    expect(onRender.mock.lastCall?.[0].hoveredTabInsertion).toBeNull()
    act(() => drag.onDragEnd(event as unknown as Parameters<typeof drag.onDragEnd>[0]))
    expect(reorderUnifiedTabs).not.toHaveBeenCalled()
  })

  it.each([
    { label: 'rejects a pane covered by another floating surface', hostWorktreeId: '' },
    { label: 'accepts terminal content overlay', hostWorktreeId: WT },
    { label: 'accepts browser content overlay', hostWorktreeId: WT },
    { label: 'rejects an overlay from another worktree', hostWorktreeId: 'other' }
  ])('$label', ({ hostWorktreeId }) => {
    addPanelGeometry(
      'group-2',
      rect({ left: 500, top: 0, width: 400, height: 600 }),
      rect({ left: 500, top: 32, width: 400, height: 568 })
    )
    const surface = document.createElement('div')
    if (hostWorktreeId) {
      surface.dataset.retainedPaneHost = ''
      surface.dataset.retainedPaneGroupId = 'group-2'
      surface.dataset.retainedPaneWorktreeId = hostWorktreeId
    }
    const content = document.createElement('div')
    surface.appendChild(content)
    document.body.appendChild(surface)
    const previous = Object.getOwnPropertyDescriptor(document, 'elementFromPoint')
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: () => content
    })
    try {
      const dropUnifiedTab = vi.fn(() => true)
      useAppStore.setState({ dropUnifiedTab } as Partial<ReturnType<typeof useAppStore.getState>>)
      const drag = renderDragHook()
      const event = makeDragEvent(makeDragData('group-1'), { x: 880, y: 300 })
      act(() => drag.onDragStart(event as unknown as Parameters<typeof drag.onDragStart>[0]))
      act(() => drag.onDragMove(event as unknown as Parameters<typeof drag.onDragMove>[0]))
      act(() => drag.onDragEnd(event as unknown as Parameters<typeof drag.onDragEnd>[0]))
      if (hostWorktreeId === WT) {
        expect(dropUnifiedTab).toHaveBeenCalledWith('tab-1', {
          groupId: 'group-2',
          splitDirection: 'right'
        })
      } else {
        expect(dropUnifiedTab).not.toHaveBeenCalled()
      }
    } finally {
      if (previous) {
        Object.defineProperty(document, 'elementFromPoint', previous)
      } else {
        Reflect.deleteProperty(document, 'elementFromPoint')
      }
    }
  })

  it('commits a geometry-only pane split when drag end has no over target', () => {
    addPanelGeometry(
      'group-2',
      rect({ left: 500, top: 0, width: 400, height: 600 }),
      rect({ left: 500, top: 32, width: 400, height: 568 })
    )
    const activeData = makeDragData('group-1')
    const dropUnifiedTab = vi.fn(() => true)
    useAppStore.setState({ dropUnifiedTab } as Partial<ReturnType<typeof useAppStore.getState>>)

    const drag = renderDragHook()

    act(() => {
      drag.onDragStart(
        makeDragEvent(activeData, { x: 880, y: 300 }) as unknown as Parameters<
          typeof drag.onDragStart
        >[0]
      )
    })
    act(() => {
      drag.onDragEnd(
        makeDragEvent(activeData, { x: 880, y: 300 }) as unknown as Parameters<
          typeof drag.onDragEnd
        >[0]
      )
    })

    expect(dropUnifiedTab).toHaveBeenCalledWith('tab-1', {
      groupId: 'group-2',
      splitDirection: 'right'
    })
  })
})
