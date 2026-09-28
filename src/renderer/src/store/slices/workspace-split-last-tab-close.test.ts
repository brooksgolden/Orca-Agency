import { describe, expect, it, vi } from 'vitest'
import { createTestStore, makeWorktree, seedStore } from './store-test-helpers'

const LEFT = 'repo1::/tmp/left'
const RIGHT = 'repo1::/tmp/right'

function pairedStore() {
  const store = createTestStore()
  seedStore(store, {
    worktreesByRepo: {
      repo1: [
        makeWorktree({ id: LEFT, repoId: 'repo1', path: '/tmp/left' }),
        makeWorktree({ id: RIGHT, repoId: 'repo1', path: '/tmp/right' })
      ]
    }
  })
  store.getState().createUnifiedTab(LEFT, 'editor', { id: 'left.md', label: 'left.md' })
  const right = store.getState().createUnifiedTab(RIGHT, 'editor', {
    id: 'right.md',
    label: 'right.md'
  })
  store.setState({ activeWorktreeId: RIGHT })
  vi.spyOn(store.getState(), 'setActiveWorktree').mockImplementation((id) => {
    store.setState({ activeWorktreeId: id })
    return true
  })
  store.getState().placeWorkspaceAtEdge(RIGHT, LEFT, 'bottom')
  return { store, right }
}

describe('closing tabs in a workspace split', () => {
  it('collapses the empty pane and selects the remaining workspace', () => {
    const { store, right } = pairedStore()

    store.getState().closeUnifiedTab(right.id)

    expect(store.getState().workspaceSplitGroups).toEqual([])
    expect(store.getState().activeWorktreeId).toBe(LEFT)
  })

  it('keeps the split while another tab remains', () => {
    const { store, right } = pairedStore()
    store.getState().createUnifiedTab(RIGHT, 'editor', { id: 'more.md', label: 'more.md' })

    store.getState().closeUnifiedTab(right.id)

    expect(store.getState().workspaceSplitGroups).toHaveLength(1)
  })

  it('keeps the split for a cleanup close that preserves workspace selection', () => {
    const { store, right } = pairedStore()

    store.getState().closeUnifiedTab(right.id, { preserveWorktreeSelection: true })

    expect(store.getState().workspaceSplitGroups).toHaveLength(1)
  })
})
