import { describe, expect, it, vi } from 'vitest'
import {
  collectWorkspacePanes,
  placeWorkspaceSurface,
  workspacePaneKey
} from './workspace-group-layout'
import {
  collectWorkspaceIds,
  readWorkspaceSplitGroups,
  writeWorkspaceSplitGroups,
  type WorkspaceLayoutNode
} from './workspace-split-layout'
import type { TabGroupLayoutNode } from '../../../shared/tab-types'

const pane = (
  workspaceId: string,
  groupId?: string
): Extract<WorkspaceLayoutNode, { type: 'leaf' }> => ({
  type: 'leaf',
  workspaceId,
  ...(groupId ? { groupId } : {})
})
const groups: Record<string, TabGroupLayoutNode> = {
  a: {
    type: 'split',
    direction: 'horizontal',
    ratio: 0.5,
    first: { type: 'leaf', groupId: 'chat' },
    second: { type: 'leaf', groupId: 'markdown' }
  },
  b: { type: 'leaf', groupId: 'other' }
}

describe('workspace panes with retained content owners', () => {
  it('stacks both chats on the left and leaves Markdown full height on the right', () => {
    const result = placeWorkspaceSurface([], groups, pane('b'), pane('a', 'chat'), 'top', 'window')!
    expect(result[0].layout).toEqual({
      type: 'split',
      direction: 'horizontal',
      ratio: 0.5,
      first: {
        type: 'split',
        direction: 'vertical',
        ratio: 0.5,
        first: pane('b'),
        second: pane('a', 'chat')
      },
      second: pane('a', 'markdown')
    })
    expect(collectWorkspaceIds(result[0].layout)).toEqual(['b', 'a'])
    expect(collectWorkspacePanes(result[0].layout).map(workspacePaneKey)).toHaveLength(3)
  })
  it('repositions a Markdown pane without creating or changing any workspace', () => {
    const original = placeWorkspaceSurface(
      [],
      groups,
      pane('b'),
      pane('a', 'chat'),
      'top',
      'window'
    )!
    const placed = placeWorkspaceSurface(
      original,
      groups,
      pane('a', 'markdown'),
      pane('b', 'other'),
      'left',
      'unused'
    )!
    expect(collectWorkspaceIds(placed[0].layout).sort()).toEqual(['a', 'b'])
    expect(
      collectWorkspacePanes(placed[0].layout)
        .map((item) => item.groupId)
        .sort()
    ).toEqual(['chat', 'markdown', 'other'])
    expect(groups.a).toEqual({
      type: 'split',
      direction: 'horizontal',
      ratio: 0.5,
      first: { type: 'leaf', groupId: 'chat' },
      second: { type: 'leaf', groupId: 'markdown' }
    })
  })
  it('supports source/preview pairs and multiple chat groups without separating content owners', () => {
    const layout: TabGroupLayoutNode = {
      type: 'split',
      direction: 'horizontal',
      first: groups.a,
      second: {
        type: 'split',
        direction: 'vertical',
        first: { type: 'leaf', groupId: 'review' },
        second: { type: 'leaf', groupId: 'preview' }
      }
    }
    const result = placeWorkspaceSurface(
      [],
      { ...groups, a: layout },
      pane('b'),
      pane('a', 'chat'),
      'top',
      'window'
    )!
    expect(collectWorkspacePanes(result[0].layout)).toHaveLength(5)
    expect(
      collectWorkspacePanes(result[0].layout).filter((item) => item.workspaceId === 'a')
    ).toHaveLength(4)
  })
  it('rejects a stale group address', () => {
    expect(
      placeWorkspaceSurface([], groups, pane('b'), pane('a', 'closed'), 'top', 'window')
    ).toBeNull()
  })
  it('restores multiple pane addresses belonging to the same workspace', () => {
    const entries = new Map<string, string>()
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => entries.get(key),
        setItem: (key: string, value: string) => entries.set(key, value)
      }
    })
    try {
      const result = placeWorkspaceSurface(
        [],
        groups,
        pane('b'),
        pane('a', 'chat'),
        'top',
        'window'
      )!
      writeWorkspaceSplitGroups(result)
      expect(readWorkspaceSplitGroups()).toEqual(result)
    } finally {
      vi.unstubAllGlobals()
    }
  })
  it('preserves independent groups and pane identities when swapping', () => {
    const original = placeWorkspaceSurface(
      [],
      groups,
      pane('b'),
      pane('a', 'chat'),
      'top',
      'window'
    )!
    const swapped = placeWorkspaceSurface(
      original,
      groups,
      pane('a', 'markdown'),
      pane('b'),
      'top',
      'unused',
      false,
      { kind: 'swap' }
    )!
    expect(collectWorkspacePanes(swapped[0].layout).map(workspacePaneKey)).toEqual([
      workspacePaneKey(pane('a', 'markdown')),
      workspacePaneKey(pane('a', 'chat')),
      'b'
    ])
  })
  it('swaps a whole single-pane workspace with a document pane', () => {
    const original = placeWorkspaceSurface(
      [],
      groups,
      pane('b'),
      pane('a', 'chat'),
      'top',
      'window'
    )!
    const swapped = placeWorkspaceSurface(
      original,
      groups,
      pane('b'),
      pane('a', 'markdown'),
      'top',
      'unused',
      false,
      { kind: 'swap' }
    )!
    expect(collectWorkspacePanes(swapped[0].layout).map(workspacePaneKey)).toEqual([
      workspacePaneKey(pane('a', 'markdown')),
      workspacePaneKey(pane('a', 'chat')),
      'b'
    ])
  })
})
