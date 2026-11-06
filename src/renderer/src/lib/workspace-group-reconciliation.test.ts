import { expect, it } from 'vitest'
import { reconcileWorkspaceGroupLayouts } from './workspace-group-reconciliation'
import { collectWorkspacePanes } from './workspace-group-layout'
import type { WorkspaceSplitGroup } from './workspace-split-layout'

const original: WorkspaceSplitGroup[] = [
  {
    id: 'window',
    layout: {
      type: 'split',
      direction: 'horizontal',
      ratio: 0.5,
      first: {
        type: 'split',
        direction: 'vertical',
        ratio: 0.5,
        first: { type: 'leaf', workspaceId: 'b' },
        second: { type: 'leaf', workspaceId: 'a', groupId: 'chat' }
      },
      second: { type: 'leaf', workspaceId: 'a', groupId: 'markdown' }
    }
  }
]
it('collapses only the closed document pane', () => {
  const result = reconcileWorkspaceGroupLayouts(original, { a: { type: 'leaf', groupId: 'chat' } })
  expect(result[0].layout).toEqual(
    original[0].layout.type === 'split' ? original[0].layout.first : null
  )
})
it('places a new group next to its original sibling without rearranging other workspaces', () => {
  const result = reconcileWorkspaceGroupLayouts(original, {
    a: {
      type: 'split',
      direction: 'horizontal',
      first: { type: 'leaf', groupId: 'chat' },
      second: {
        type: 'split',
        direction: 'vertical',
        first: { type: 'leaf', groupId: 'markdown' },
        second: { type: 'leaf', groupId: 'preview' }
      }
    }
  })
  expect(result[0].layout).toMatchObject({
    first: original[0].layout.type === 'split' ? original[0].layout.first : null,
    second: {
      direction: 'vertical',
      first: { groupId: 'markdown' },
      second: { groupId: 'preview' }
    }
  })
  expect(collectWorkspacePanes(result[0].layout)).toHaveLength(4)
})
it('does not publish new state when no group membership changed', () => {
  expect(
    reconcileWorkspaceGroupLayouts(original, {
      a: {
        type: 'split',
        direction: 'horizontal',
        first: { type: 'leaf', groupId: 'chat' },
        second: { type: 'leaf', groupId: 'markdown' }
      }
    })
  ).toBe(original)
})

it('retains an owner slot when all its group ids regenerate on restore', () => {
  const result = reconcileWorkspaceGroupLayouts(original, {
    a: { type: 'leaf', groupId: 'restored' }
  })
  expect(collectWorkspacePanes(result[0].layout)).toEqual([
    { type: 'leaf', workspaceId: 'b' },
    { type: 'leaf', workspaceId: 'a' }
  ])
})

it('keeps an empty restored owner inside its own slot', () => {
  const result = reconcileWorkspaceGroupLayouts(original, {})
  expect(collectWorkspacePanes(result[0].layout)).toEqual([
    { type: 'leaf', workspaceId: 'b' },
    { type: 'leaf', workspaceId: 'a' }
  ])
})
