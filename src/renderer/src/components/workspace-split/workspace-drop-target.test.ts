import { describe, expect, it } from 'vitest'
import { workspaceDropTarget } from './workspace-drop-target'
import { placeWorkspaceAtEdge, collectWorkspaceIds } from '@/lib/workspace-split-layout'

describe('whole-window workspace drops', () => {
  const root = { left: 0, top: 0, right: 1000, bottom: 800 }
  const left = { ...root, right: 500 }
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
