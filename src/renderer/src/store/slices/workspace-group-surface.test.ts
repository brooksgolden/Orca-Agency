import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestStore, makeWorktree, seedStore } from './store-test-helpers'
import { createTabsSliceMockApi } from './tabs-slice-test-harness'
import { collectWorkspacePanes } from '@/lib/workspace-group-layout'
import { placeWorkspaceAtEdge } from '@/lib/workspace-split-layout'

vi.mock('sonner', () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() } }))
createTabsSliceMockApi()
describe('atomic pane placement without content transfers', () => {
  let store: ReturnType<typeof createTestStore>
  beforeEach(() => {
    store = createTestStore()
    seedStore(store, {
      worktreesByRepo: {
        repo1: ['a', 'b'].map((id) =>
          makeWorktree({ id, repoId: 'repo1', hostId: 'local', path: `/different/${id}` })
        )
      }
    })
    store.getState().createTab('a')
    store.getState().createTab('b')
    store.getState().placeWorkspaceAtEdge('b', 'a', 'right')
  })
  function addDocuments() {
    const root = store.getState().groupsByWorktree.a[0].id
    const docGroup = store.getState().createEmptySplitGroup('a', root, 'right')!
    store.getState().openFile(
      {
        filePath: '/different/a/notes.md',
        relativePath: 'notes.md',
        worktreeId: 'a',
        language: 'markdown',
        mode: 'edit'
      },
      { targetGroupId: docGroup }
    )
    store.getState().openFile(
      {
        filePath: '/different/a/second.md',
        relativePath: 'second.md',
        worktreeId: 'a',
        language: 'markdown',
        mode: 'edit'
      },
      { targetGroupId: docGroup }
    )
    const file = store.getState().openFiles[0]
    store.setState({ editorDrafts: { [file.id]: 'Human edit still unsaved' } })
    return { root, docGroup, file }
  }
  it('keeps document ownership, drafts, all live terminals and original workspace membership', () => {
    const { root } = addDocuments()
    const before = store.getState()
    expect(
      before.placeWorkspaceSurface(
        { type: 'leaf', workspaceId: 'b' },
        { type: 'leaf', workspaceId: 'a', groupId: root },
        'top'
      )
    ).toBe(true)
    const after = store.getState()
    for (const key of [
      'openFiles',
      'editorDrafts',
      'tabsByWorktree',
      'ptyIdsByTabId',
      'folderWorkspaces',
      'groupsByWorktree',
      'unifiedTabsByWorktree'
    ] as const) {
      expect(after[key]).toBe(before[key])
    }
  })
  it('splits off one document tab atomically while retaining its original file identity', () => {
    const { docGroup, file } = addDocuments()
    const before = store.getState()
    const tab = before.unifiedTabsByWorktree.a.find((item) => item.entityId === file.id)!
    expect(
      before.placeWorkspaceSurface(
        { type: 'leaf', workspaceId: 'a', groupId: docGroup },
        { type: 'leaf', workspaceId: 'b' },
        'right',
        { unifiedTabId: tab.id }
      )
    ).toBe(true)
    const after = store.getState()
    expect(after.unifiedTabsByWorktree.a.find((item) => item.id === tab.id)).toMatchObject({
      entityId: file.id,
      worktreeId: 'a'
    })
    expect(after.unifiedTabsByWorktree.a.find((item) => item.id === tab.id)?.groupId).not.toBe(
      docGroup
    )
    expect(after.openFiles).toBe(before.openFiles)
    expect(after.editorDrafts).toBe(before.editorDrafts)
    expect(after.tabsByWorktree).toBe(before.tabsByWorktree)
    expect(after.folderWorkspaces).toBe(before.folderWorkspaces)
  })
  it('rolls back the entire tab split when the target group was closed', () => {
    const { docGroup, file } = addDocuments()
    const before = store.getState()
    const tab = before.unifiedTabsByWorktree.a.find((item) => item.entityId === file.id)!
    expect(
      before.placeWorkspaceSurface(
        { type: 'leaf', workspaceId: 'a', groupId: docGroup },
        { type: 'leaf', workspaceId: 'b', groupId: 'closed' },
        'right',
        { unifiedTabId: tab.id }
      )
    ).toBe(false)
    expect(store.getState()).toBe(before)
  })
  it('does not create a new tab group when the window split is full', () => {
    const { docGroup, file } = addDocuments()
    let groups = placeWorkspaceAtEdge([], 'b', 'a', 'right', 'window')
    for (let index = 0; index < 14; index++) {
      groups = placeWorkspaceAtEdge(groups, `other-${index}`, 'b', 'right', 'unused')
    }
    store.setState({ workspaceSplitGroups: groups })
    const before = store.getState()
    const tab = before.unifiedTabsByWorktree.a.find((item) => item.entityId === file.id)!
    expect(
      before.placeWorkspaceSurface(
        { type: 'leaf', workspaceId: 'a', groupId: docGroup },
        { type: 'leaf', workspaceId: 'b' },
        'right',
        { unifiedTabId: tab.id }
      )
    ).toBe(false)
    expect(store.getState()).toBe(before)
    expect(collectWorkspacePanes(store.getState().workspaceSplitGroups[0].layout)).toHaveLength(16)
  })
})
