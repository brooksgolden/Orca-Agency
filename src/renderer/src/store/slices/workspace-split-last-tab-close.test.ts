import { describe, expect, it, vi } from 'vitest'
import { createTestStore, makeWorktree, seedStore } from './store-test-helpers'

const LEFT = 'repo1::/tmp/left'
const RIGHT = 'repo1::/tmp/right'
const MIDDLE = 'repo1::/tmp/middle'

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

  it('collapses when the terminal close path removes the last tab', () => {
    const { store, right } = pairedStore()
    const terminal = store.getState().createTab(RIGHT)
    store.getState().closeUnifiedTab(right.id)
    store.getState().closeTab(terminal.id)
    expect(store.getState().workspaceSplitGroups).toEqual([])
    expect(store.getState().activeWorktreeId).toBe(LEFT)
  })

  it('keeps the split for a cleanup close that preserves workspace selection', () => {
    const { store, right } = pairedStore()

    store.getState().closeUnifiedTab(right.id, { preserveWorktreeSelection: true })

    expect(store.getState().workspaceSplitGroups).toHaveLength(1)
  })

  it('dismisses the pane after its last terminal closes with Markdown still open', () => {
    const { store, right } = pairedStore()
    const terminal = store.getState().createTab(RIGHT)

    store.getState().closeTab(terminal.id)

    expect(store.getState().workspaceSplitGroups).toEqual([])
    expect(store.getState().activeWorktreeId).toBe(LEFT)
    expect(store.getState().getTab(right.id)).not.toBeNull()
  })

  it('keeps the pane when another terminal remains beside the Markdown', () => {
    const { store } = pairedStore()
    const first = store.getState().createTab(RIGHT)
    const second = store.getState().createTab(RIGHT)

    store.getState().closeTab(first.id)

    expect(store.getState().workspaceSplitGroups).toHaveLength(1)
    expect(store.getState().tabsByWorktree[RIGHT].map((tab) => tab.id)).toEqual([second.id])
  })

  it('keeps the pane when a structured chat remains after a terminal closes', () => {
    const { store } = pairedStore()
    const terminal = store.getState().createTab(RIGHT)
    store.getState().createUnifiedTab(RIGHT, 'agent-session', { entityId: 'chat-session' })

    store.getState().closeTab(terminal.id)

    expect(store.getState().workspaceSplitGroups).toHaveLength(1)
  })

  it('dismisses the pane after its last structured chat closes with Markdown open', () => {
    const { store, right } = pairedStore()
    const chat = store.getState().createUnifiedTab(RIGHT, 'agent-session', {
      entityId: 'chat-session'
    })

    store.getState().closeUnifiedTab(chat.id)

    expect(store.getState().workspaceSplitGroups).toEqual([])
    expect(store.getState().activeWorktreeId).toBe(LEFT)
    expect(store.getState().getTab(right.id)).not.toBeNull()
  })

  it.each(['cleanup', 'pty-exit'] as const)(
    'keeps a pane with Markdown after a %s terminal close',
    (reason) => {
      const { store } = pairedStore()
      const terminal = store.getState().createTab(RIGHT)

      store.getState().closeTab(terminal.id, { reason })

      expect(store.getState().workspaceSplitGroups).toHaveLength(1)
    }
  )

  it('dismisses a folder workspace pane while preserving its files', () => {
    const { store } = pairedStore()
    const folder = 'folder:seolocal'
    const file = store.getState().createUnifiedTab(folder, 'editor', {
      entityId: 'calendar.md'
    })
    const terminal = store.getState().createTab(folder)
    store.getState().placeWorkspaceAtEdge(folder, LEFT, 'right')
    store.setState({ activeWorktreeId: folder })
    expect(JSON.stringify(store.getState().workspaceSplitGroups)).toContain(folder)

    store.getState().closeTab(terminal.id)

    expect(JSON.stringify(store.getState().workspaceSplitGroups)).not.toContain(folder)
    expect(store.getState().getTab(file.id)).not.toBeNull()
    expect(store.getState().activeWorktreeId).toBe(LEFT)
  })

  it('does not switch away from a different focused workspace', () => {
    const { store } = pairedStore()
    const terminal = store.getState().createTab(RIGHT)
    store.setState({ activeWorktreeId: LEFT })
    const setActiveWorktree = vi.mocked(store.getState().setActiveWorktree)
    setActiveWorktree.mockClear()

    store.getState().closeTab(terminal.id)

    expect(store.getState().workspaceSplitGroups).toEqual([])
    expect(store.getState().activeWorktreeId).toBe(LEFT)
    expect(setActiveWorktree).not.toHaveBeenCalled()
  })

  it('dismisses through the unified terminal X path with Markdown open', () => {
    const { store } = pairedStore()
    const terminal = store.getState().createTab(RIGHT)
    const unified = store
      .getState()
      .unifiedTabsByWorktree[RIGHT].find(
        (tab) => tab.contentType === 'terminal' && tab.entityId === terminal.id
      )!

    store.getState().closeUnifiedTab(unified.id)

    expect(store.getState().workspaceSplitGroups).toEqual([])
  })

  it('keeps supporting files for a retirement with no explicit user close reason', () => {
    const { store } = pairedStore()
    const terminal = store.getState().createUnifiedTab(RIGHT, 'terminal', {
      entityId: 'already-retired-terminal'
    })

    store.getState().closeUnifiedTab(terminal.id, { terminalRetirementHandled: true })

    expect(store.getState().workspaceSplitGroups).toHaveLength(1)
  })

  it.each(['cleanup', 'pty-exit'] as const)(
    'forwards a %s reason through the unified terminal close path',
    (terminalCloseReason) => {
      const { store } = pairedStore()
      const terminal = store.getState().createTab(RIGHT)
      const unified = store
        .getState()
        .unifiedTabsByWorktree[RIGHT].find(
          (tab) => tab.contentType === 'terminal' && tab.entityId === terminal.id
        )!

      store.getState().closeUnifiedTab(unified.id, { terminalCloseReason })

      expect(store.getState().workspaceSplitGroups).toHaveLength(1)
    }
  )

  it('removes only the emptied middle pane from a three-workspace split', () => {
    const { store } = pairedStore()
    seedStore(store, {
      worktreesByRepo: {
        repo1: [
          makeWorktree({ id: LEFT, repoId: 'repo1', path: '/tmp/left' }),
          makeWorktree({ id: RIGHT, repoId: 'repo1', path: '/tmp/right' }),
          makeWorktree({ id: MIDDLE, repoId: 'repo1', path: '/tmp/middle' })
        ]
      }
    })
    const middle = store.getState().createUnifiedTab(MIDDLE, 'editor', {
      id: 'middle.md',
      label: 'middle.md'
    })
    store.getState().placeWorkspaceAtEdge(MIDDLE, LEFT, 'right')
    store.setState({ activeWorktreeId: MIDDLE })

    store.getState().closeUnifiedTab(middle.id)

    const groups = store.getState().workspaceSplitGroups
    expect(groups).toHaveLength(1)
    expect(JSON.stringify(groups)).toContain(LEFT)
    expect(JSON.stringify(groups)).toContain(RIGHT)
    expect(JSON.stringify(groups)).not.toContain(MIDDLE)
    expect(store.getState().activeWorktreeId).toBe(LEFT)
    expect(store.getState().unifiedTabsByWorktree[LEFT]).toHaveLength(1)
    expect(store.getState().unifiedTabsByWorktree[RIGHT]).toHaveLength(1)
  })
})
