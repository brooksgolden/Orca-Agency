import { describe, expect, it } from 'vitest'
import { chatSidebarListItems } from './chat-sidebar-groups'
import { buildChatSidebarRows } from './chat-sidebar-rows'
import { chatRow, chatState, chatTab, chatWorktree } from './chat-sidebar-test-fixtures'
import { placeWorkspaceAtEdge, removeWorkspaceFromSplit } from '@/lib/workspace-split-layout'

describe('workspace chat groups', () => {
  const state = chatState({ tabsByWorktree: { [chatWorktree.id]: [chatTab('a'), chatTab('b')] } })
  const main = chatRow({ id: 'main', tabId: 'a', completed: true, timestamp: 10 })
  const child = chatRow({
    id: 'child',
    tabId: 'b',
    title: 'Claude review',
    state: 'working',
    timestamp: 20
  })
  const other = chatRow({ id: 'other', worktree: { ...chatWorktree, id: 'other' }, timestamp: 100 })

  it('brackets split workspaces together and restores independent sorting after unsplitting', () => {
    const older = { ...other, timestamp: 1, completed: true }
    const middle = {
      ...other,
      id: 'middle',
      worktree: { ...chatWorktree, id: 'middle' },
      timestamp: 50
    }
    const splits = placeWorkspaceAtEdge([], older.worktree.id, main.worktree.id, 'right', 'joined')
    const joined = chatSidebarListItems([main, child, middle, older], state, '', splits)
    const chats = joined.filter((item) => item.kind === 'chat')
    expect(chats.map((item) => item.id)).toEqual(['main', 'child', 'other', 'middle'])
    expect(chats.map((item) => item.splitId)).toEqual(['joined', 'joined', 'joined', undefined])
    expect(chats[0].splitStart).toBe(true)
    expect(chats[2].splitEnd).toBe(true)
    expect(chats[2].subTab).toBe(false)
    const unjoined = chatSidebarListItems(
      [main, child, middle, older],
      state,
      '',
      removeWorkspaceFromSplit(splits, older.worktree.id)
    )
    expect(unjoined.filter((item) => item.kind === 'chat').map((item) => item.id)).toEqual([
      'main',
      'child',
      'middle',
      'other'
    ])
    expect(unjoined.filter((item) => item.kind === 'chat').some((item) => item.splitId)).toBe(false)
  })

  it('respects hidden folders, search and multi-folder split windows', () => {
    const splits = placeWorkspaceAtEdge([], other.worktree.id, main.worktree.id, 'right', 'joined')
    const folderState = chatState({
      ...state,
      settings: { ...state.settings!, chatSidebar: { groupBy: 'folder' } }
    })
    const moved = { ...other, folder: 'Other folder' }
    const items = chatSidebarListItems([main, child, moved], folderState, 'review', splits)
    expect(items[0]).toMatchObject({ label: 'Split workspaces (3)' })
    expect(items.filter((item) => item.kind === 'chat').map((item) => item.id)).toEqual([
      'main',
      'child',
      'other'
    ])
    const hidden = chatState({
      ...folderState,
      settings: { ...state.settings!, chatSidebar: { hiddenFolders: ['Other folder'] } }
    })
    expect(
      chatSidebarListItems([main, child, moved], hidden, '', splits)
        .filter((item) => item.kind === 'chat')
        .some((item) => item.splitId)
    ).toBe(false)
  })

  it('orders whole groups by activity while keeping the first chat as the parent', () => {
    const items = chatSidebarListItems([other, child, main], state, '')
    expect(
      items
        .filter((item) => item.kind === 'chat')
        .map((item) => [item.id, item.subTab, item.showFolder])
    ).toEqual([
      ['main', false, false],
      ['child', true, true],
      ['other', false, true]
    ])
    expect(items[0]).toMatchObject({ kind: 'heading', label: 'In progress (3)' })
    expect(
      chatSidebarListItems([main, { ...child, completed: true, state: 'idle' }], state, '')[0]
    ).toMatchObject({ label: 'Done (2)' })
  })

  it('preserves parent context in search without reintroducing hidden folders or automation chats', () => {
    const filtered = chatState({
      ...state,
      settings: { ...state.settings!, chatSidebar: { hiddenFolders: ['Hidden'] } }
    })
    const items = chatSidebarListItems(
      [
        main,
        child,
        { ...main, id: 'unrelated-sibling', title: 'Other subject' },
        { ...other, folder: 'Hidden' },
        { ...other, id: 'bot', automated: true }
      ],
      filtered,
      'review'
    )
    expect(items.filter((item) => item.kind === 'chat').map((item) => item.id)).toEqual([
      'main',
      'child'
    ])
  })

  it('files moved siblings under the correct heading in Folder view', () => {
    const folderState = chatState({
      ...state,
      settings: { ...state.settings!, chatSidebar: { groupBy: 'folder' } }
    })
    const items = chatSidebarListItems([main, { ...child, folder: 'Other' }], folderState, '')
    expect(items.filter((item) => item.kind === 'heading').map((item) => item.label)).toEqual([
      'Other (1)',
      'Acme (1)'
    ])
    expect(items.filter((item) => item.kind === 'chat').every((item) => !item.subTab)).toBe(true)
  })

  it('keeps a closed main chat ahead of later open or resumed siblings', () => {
    const items = chatSidebarListItems(
      [
        { ...main, createdAt: 100, tabId: null },
        { ...child, createdAt: 200 }
      ],
      state,
      ''
    )
    expect(items.filter((item) => item.kind === 'chat').map((item) => item.id)).toEqual([
      'main',
      'child'
    ])
  })

  it('does not group workspaces on different hosts or merge distinct workspaces in the same directory', () => {
    const items = chatSidebarListItems([main, other, { ...child, hostId: 'ssh:box' }], state, '')
    expect(items.filter((item) => item.kind === 'chat').every((item) => !item.subTab)).toBe(true)
  })

  it('shows individual folders when siblings have been filed in different folders', () => {
    const items = chatSidebarListItems([main, { ...child, folder: 'Other' }], state, '')
    expect(items.filter((item) => item.kind === 'chat').every((item) => item.showFolder)).toBe(true)
  })

  it('keeps every LLM tab and excludes plain terminals, Markdown and browser tabs', () => {
    const tabs = Array.from({ length: 24 }, (_, index) => chatTab(`chat-${index}`))
    const source = chatState({
      tabsByWorktree: {
        [chatWorktree.id]: [
          ...tabs,
          chatTab('plain', { launchAgent: undefined, aiVaultTitle: null })
        ]
      },
      unifiedTabsByWorktree: {
        [chatWorktree.id]: (['editor', 'browser'] as const).map((contentType) => ({
          id: contentType,
          entityId: contentType,
          groupId: 'group',
          worktreeId: chatWorktree.id,
          contentType,
          label: contentType === 'editor' ? 'notes.md' : 'Website',
          customLabel: null,
          color: null,
          sortOrder: 0,
          createdAt: 1
        }))
      }
    })
    const items = chatSidebarListItems(buildChatSidebarRows(source, [], 10_000), source, '')
    const chats = items.filter((item) => item.kind === 'chat')
    expect(chats).toHaveLength(24)
    expect(chats.filter((item) => item.subTab)).toHaveLength(23)
    expect(chats[0].row.tabId).toBe('chat-0')
  })
})
