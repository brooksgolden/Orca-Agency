import { describe, expect, it } from 'vitest'
import { workspaceTouchesWindowEdge } from './workspace-window-edges'
import { placeWorkspaceAtEdge, collectWorkspaceIds } from '@/lib/workspace-split-layout'

describe('pane header window corners', () => {
  const pair = placeWorkspaceAtEdge([], 'right', 'left', 'right', 'grid')
  const rows = placeWorkspaceAtEdge(pair, 'bottom', 'left', 'bottom', 'grid', true)
  it('reserves window controls only for the top-right pane', () => {
    const root = rows[0].layout
    const corners = collectWorkspaceIds(root).filter(
      (id) =>
        workspaceTouchesWindowEdge(root, id, 'top') && workspaceTouchesWindowEdge(root, id, 'right')
    )
    expect(corners).toEqual(['right'])
    expect(workspaceTouchesWindowEdge(root, 'bottom', 'top')).toBe(false)
  })
  it('repositions a pane at the whole-window edge over its own surface', () => {
    const moved = placeWorkspaceAtEdge(rows, 'left', 'left', 'bottom', 'grid', true)
    expect(moved[0].layout).toMatchObject({
      type: 'split',
      direction: 'vertical',
      second: { type: 'leaf', workspaceId: 'left' }
    })
    expect(collectWorkspaceIds(moved[0].layout).sort()).toEqual(['bottom', 'left', 'right'])
  })
})
