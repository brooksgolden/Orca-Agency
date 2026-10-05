import { describe, expect, it } from 'vitest'
import { workspaceDropTarget } from './workspace-drop-target'
import { placeWorkspaceAtEdge, collectWorkspaceIds } from '@/lib/workspace-split-layout'

describe('whole-window workspace drops', () => {
  const root = { left: 0, top: 0, right: 1000, bottom: 800 }
  const left = { ...root, right: 500 }
  it.each(['top', 'bottom'] as const)('keeps the %s quadrant reachable in a tall pane', (edge) => {
    const tallRoot = { left: 0, top: 0, right: 1000, bottom: 1600 }
    const right = { ...tallRoot, left: 500 }
    const y = edge === 'top' ? 400 : 1200
    for (const x of [750, 992]) {
      expect(workspaceDropTarget(tallRoot, right, x, y, true)).toEqual({ edge, wholeWindow: false })
    }
    expect(workspaceDropTarget(tallRoot, right, 992, 800, true)).toEqual({
      edge: 'right',
      wholeWindow: true
    })
  })
  it.each(['left', 'right'] as const)('keeps the %s quadrant reachable in a wide pane', (edge) => {
    const bottom = { ...root, top: 400 }
    const x = edge === 'left' ? 250 : 750
    expect(workspaceDropTarget(root, bottom, x, 792, true)).toEqual({ edge, wholeWindow: false })
    expect(workspaceDropTarget(root, bottom, 500, 792, true)).toEqual({
      edge: 'bottom',
      wholeWindow: true
    })
  })
  it('uses proportions for resized panes that do not span the window', () => {
    const pane = { left: 400, top: 100, right: 600, bottom: 700 }
    expect(workspaceDropTarget(root, pane, 500, 250, true)).toEqual({
      edge: 'top',
      wholeWindow: false
    })
  })
  it('recognizes full-span panes with fractional scaled bounds', () => {
    const pane = { left: 500, top: 0.25, right: 1000, bottom: 799.75 }
    expect(workspaceDropTarget(root, pane, 992, 680, true)).toEqual({
      edge: 'bottom',
      wholeWindow: false
    })
  })
  it('previews the entire bottom at the outer edge and only a quadrant farther inside', () => {
    expect(workspaceDropTarget(root, left, 250, 790, true)).toEqual({
      edge: 'bottom',
      wholeWindow: true
    })
    expect(workspaceDropTarget(root, left, 250, 740, true)).toEqual({
      edge: 'bottom',
      wholeWindow: false
    })
    expect(workspaceDropTarget(root, left, 250, 10, true)).toEqual({
      edge: 'top',
      wholeWindow: true
    })
  })
  it.each(['top', 'bottom'] as const)(
    'keeps the existing two panes together when adding a full-width %s pane',
    (edge) => {
      const paired = placeWorkspaceAtEdge([], 'b', 'a', 'right', 'split')
      const result = placeWorkspaceAtEdge(paired, 'c', 'a', edge, 'unused', true)
      const layout = result[0].layout
      expect(layout.type).toBe('split')
      if (layout.type !== 'split') {
        throw new Error('Expected split')
      }
      expect(layout.direction).toBe('vertical')
      expect(edge === 'top' ? layout.second : layout.first).toEqual(paired[0].layout)
      expect(collectWorkspaceIds(layout).sort()).toEqual(['a', 'b', 'c'])
    }
  )
})
