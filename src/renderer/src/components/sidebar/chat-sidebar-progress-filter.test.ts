import { describe, expect, it } from 'vitest'
import { chatSidebarListItems } from './chat-sidebar-groups'
import { chatRow, chatState, chatTab, chatWorktree } from './chat-sidebar-test-fixtures'
import { placeWorkspaceAtEdge } from '@/lib/workspace-split-layout'
import { updateChatSidebarSettings } from '@/lib/chat-sidebar-settings-update'
import type { ChatSidebarSettings } from '../../../../shared/chat-sidebar-settings'

function source(groupBy: 'folder' | 'status' | 'recent', showOnlyInProgress = true) {
  const state = chatState({
    tabsByWorktree: { [chatWorktree.id]: [chatTab('a'), chatTab('b'), chatTab('c')] }
  })
  return {
    ...state,
    settings: { ...state.settings!, chatSidebar: { groupBy, showOnlyInProgress } }
  }
}

const rows = [
  chatRow({ id: 'main', tabId: 'a', ownsWorkspaceName: true }),
  chatRow({ id: 'sub', tabId: 'b', state: 'idle' }),
  chatRow({ id: 'done-tab', tabId: 'c', completed: true }),
  chatRow({ id: 'history', tabId: null, completed: true }),
  chatRow({ id: 'done-folder', folder: 'Completed only', tabId: null, completed: true })
]

describe('chat sidebar in-progress filter', () => {
  it.each(['folder', 'status', 'recent'] as const)(
    'hides Done chats while retaining idle in-progress tabs under %s grouping',
    (groupBy) => {
      const items = chatSidebarListItems(rows, source(groupBy), '')
      expect(items.filter((item) => item.kind === 'chat').map((item) => item.id)).toEqual([
        'main',
        'sub'
      ])
      expect(items.filter((item) => item.kind === 'chat').map((item) => item.subTab)).toEqual([
        false,
        true
      ])
      expect(items.filter((item) => item.kind === 'heading').map((item) => item.label)).toEqual(
        groupBy === 'recent'
          ? []
          : groupBy === 'folder'
            ? ['Acme (2)', 'Completed only (0)']
            : ['In Progress (2)']
      )
    }
  )

  it('restores Done chats when disabled without changing the records or folder collapse state', () => {
    const state = source('folder', false)
    const before = JSON.stringify({ rows, state })
    const items = chatSidebarListItems(rows, state, '', [], new Set(['chat:folder:Acme']))
    expect(items.find((item) => item.id === 'chat:folder:Acme')).toMatchObject({
      label: 'Acme (4)',
      collapsed: true
    })
    expect(items.filter((item) => item.kind === 'chat').map((item) => item.id)).toEqual([
      'done-folder'
    ])
    expect(JSON.stringify({ rows, state })).toBe(before)
    expect(
      chatSidebarListItems(rows, state, '').filter((item) => item.kind === 'chat')
    ).toHaveLength(5)
  })

  it('promotes the remaining child when its completed parent is filtered out', () => {
    const items = chatSidebarListItems(
      rows.map((row) => (row.id === 'main' ? { ...row, completed: true } : row)),
      source('folder'),
      ''
    ).filter((item) => item.kind === 'chat')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ id: 'sub', subTab: false, showFolder: true })
  })

  it('keeps visible split panes bracketed and does not restore filtered chats through search', () => {
    const other = chatRow({
      id: 'other',
      worktree: { ...chatWorktree, id: 'other-workspace' },
      folder: 'Other folder'
    })
    const splits = placeWorkspaceAtEdge([], other.worktree.id, chatWorktree.id, 'right', 'split')
    const items = chatSidebarListItems([...rows, other], source('folder'), '', splits).filter(
      (item) => item.kind === 'chat'
    )
    expect(items.map((item) => item.id)).toEqual(['main', 'sub', 'other'])
    expect(items.map((item) => item.splitId)).toEqual(['split', 'split', 'split'])
    expect(items.map((item) => item.showFolder)).toEqual([false, true, true])
    expect(items[0].splitStart).toBe(true)
    expect(items[2].splitEnd).toBe(true)
    expect(chatSidebarListItems(rows, source('folder'), 'Completed only')).toMatchObject([
      { kind: 'heading', label: 'Completed only (0)' }
    ])
    expect(
      chatSidebarListItems(
        rows,
        {
          ...source('folder'),
          settings: {
            ...source('folder').settings,
            chatSidebar: {
              groupBy: 'folder',
              showOnlyInProgress: true,
              hiddenFolders: ['Acme', 'Completed only']
            }
          }
        },
        ''
      )
    ).toEqual([])
  })
})

describe('chat sidebar hide idle filter', () => {
  const sidebarState = (idle: boolean) => {
    const state = chatState({
      tabsByWorktree: { [chatWorktree.id]: [chatTab('a'), chatTab('b'), chatTab('c')] }
    })
    return {
      ...state,
      settings: {
        ...state.settings!,
        chatSidebar: { groupBy: 'status' as const, hideChats: { idle } }
      }
    }
  }
  const chatIds = (items: ReturnType<typeof chatSidebarListItems>) =>
    items.filter((item) => item.kind === 'chat').map((item) => item.id)
  const statusRows = [
    chatRow({ id: 'idle-tab', tabId: 'a', state: 'idle', title: 'Idle tab chat' }),
    chatRow({ id: 'working', tabId: 'b', state: 'working' }),
    chatRow({ id: 'permission', tabId: 'c', state: 'idle', displayState: 'permission' }),
    chatRow({ id: 'waiting', tabId: null, state: 'waiting' }),
    chatRow({ id: 'finished', tabId: null, state: 'idle', displayState: 'done' }),
    chatRow({ id: 'interrupted', tabId: null, state: 'interrupted' }),
    chatRow({ id: 'done', tabId: null, state: 'idle', completed: true }),
    chatRow({ id: 'idle-history', tabId: null, state: 'idle' })
  ]
  const kept = ['working', 'permission', 'waiting', 'finished', 'interrupted', 'done']

  it('hides idle rows when on and shows them when off', () => {
    expect(chatIds(chatSidebarListItems(statusRows, sidebarState(true), '')).sort()).toEqual(
      [...kept].sort()
    )
    expect(chatIds(chatSidebarListItems(statusRows, sidebarState(false), '')).sort()).toEqual(
      [...kept, 'idle-tab', 'idle-history'].sort()
    )
  })

  it('keeps a focused or on-screen idle chat visible without restoring hidden history', () => {
    const items = chatSidebarListItems(
      statusRows,
      sidebarState(true),
      '',
      [],
      undefined,
      undefined,
      new Set(['a'])
    )
    expect(chatIds(items)).toContain('idle-tab')
    expect(chatIds(items)).not.toContain('idle-history')
  })

  it('reappears when the chat starts working again', () => {
    const rows = statusRows.map((row) =>
      row.id === 'idle-tab' ? chatRow({ ...row, state: 'working', promptBackedWorking: true }) : row
    )
    expect(chatIds(chatSidebarListItems(rows, sidebarState(true), ''))).toContain('idle-tab')
  })

  it('keeps the Find chat box from restoring hidden idle rows', () => {
    const items = chatSidebarListItems(statusRows, sidebarState(true), 'idle tab')
    expect(chatIds(items)).toEqual([])
  })

  it('keeps an emptied folder heading as Done folders do', () => {
    const state = chatState({
      tabsByWorktree: { [chatWorktree.id]: [chatTab('a')] }
    })
    const items = chatSidebarListItems(
      [chatRow({ id: 'quiet', folder: 'Quiet', tabId: null, state: 'idle' })],
      {
        ...state,
        settings: {
          ...state.settings!,
          chatSidebar: { groupBy: 'folder', hideChats: { idle: true } }
        }
      },
      ''
    )
    expect(items).toMatchObject([{ kind: 'heading', label: 'Quiet (0)' }])
  })

  it('persists through the shared settings update and survives a reload', async () => {
    const owner = {
      settings: { chatSidebar: { groupBy: 'folder' as const } } as {
        chatSidebar?: ChatSidebarSettings
      } | null,
      updateSettings: async (updates: { chatSidebar?: ChatSidebarSettings }) => {
        owner.settings = { ...owner.settings, ...updates }
      }
    }
    await updateChatSidebarSettings(() => owner as never, { hideChats: { idle: true } })
    // Why: a relaunch rebuilds the sidebar from the saved settings object alone.
    const reloaded = owner.settings?.chatSidebar
    expect(reloaded).toEqual({ groupBy: 'folder', hideChats: { idle: true } })
    const state = chatState({ tabsByWorktree: { [chatWorktree.id]: [chatTab('a')] } })
    const items = chatSidebarListItems(
      [chatRow({ id: 'idle-tab', tabId: 'a', state: 'idle' })],
      { ...state, settings: { ...state.settings!, chatSidebar: reloaded } },
      ''
    )
    expect(chatIds(items)).toEqual([])
  })
})

describe('chat sidebar Hide Chats and Collapse Folders states', () => {
  const stateWith = (chatSidebar: ChatSidebarSettings) => {
    const state = chatState({
      tabsByWorktree: { [chatWorktree.id]: [chatTab('a'), chatTab('b'), chatTab('c')] }
    })
    return { ...state, settings: { ...state.settings!, chatSidebar } }
  }
  const chatIds = (items: ReturnType<typeof chatSidebarListItems>) =>
    items.filter((item) => item.kind === 'chat').map((item) => item.id)
  const doneRows = [
    chatRow({ id: 'closed-done', tabId: null, completed: true }),
    chatRow({ id: 'open-done', tabId: 'a', state: 'done', completed: false })
  ]

  it('splits white explicit completion from green reported completion', () => {
    expect(
      chatIds(
        chatSidebarListItems(
          doneRows,
          stateWith({ groupBy: 'status', hideChats: { doneClosed: true } }),
          ''
        )
      )
    ).toEqual(['open-done'])
    expect(
      chatIds(
        chatSidebarListItems(
          doneRows,
          stateWith({ groupBy: 'status', hideChats: { doneOpen: true } }),
          ''
        )
      )
    ).toEqual(['closed-done'])
  })

  it('hides green completion even for history and presentation-derived states', () => {
    const result = chatSidebarListItems(
      [
        chatRow({ id: 'green-history', tabId: null, state: 'done' }),
        chatRow({ id: 'green-display', tabId: 'b', state: 'idle', displayState: 'done' }),
        chatRow({ id: 'white-resident', tabId: 'c', completed: true }),
        chatRow({ id: 'working', tabId: 'a', state: 'working' })
      ],
      stateWith({ groupBy: 'status', hideChats: { doneOpen: true } }),
      ''
    )
    expect(chatIds(result).sort()).toEqual(['white-resident', 'working'])
  })

  it.each([false, true])('maps the legacy Hide Done flag to both Done states (on=%s)', (on) => {
    const legacy = chatSidebarListItems(
      rows,
      stateWith({ groupBy: 'folder', showOnlyInProgress: on, collapseDoneFolders: on }),
      ''
    )
    const modern = chatSidebarListItems(
      rows,
      stateWith({
        groupBy: 'folder',
        hideChats: { doneClosed: on, doneOpen: on },
        collapseFolders: { doneClosed: on, doneOpen: on }
      }),
      ''
    )
    expect(modern).toEqual(legacy)
  })

  it('collapses a folder only when every chat in it is checked', () => {
    const folderRows = [
      chatRow({ id: 'q1', folder: 'Quiet', tabId: null, state: 'idle' }),
      chatRow({ id: 'q2', folder: 'Quiet', tabId: null, state: 'idle' }),
      chatRow({ id: 'busy', folder: 'Quiet', tabId: null, state: 'working' })
    ]
    const heading = (items: ReturnType<typeof chatSidebarListItems>) =>
      items.find((item) => item.kind === 'heading' && item.label.startsWith('Quiet'))
    const collapsed = stateWith({ groupBy: 'folder', collapseFolders: { idle: true } })
    expect(heading(chatSidebarListItems(folderRows, collapsed, ''))).toMatchObject({
      collapsed: false
    })
    expect(heading(chatSidebarListItems(folderRows.slice(0, 2), collapsed, ''))).toMatchObject({
      collapsed: true,
      doneFolder: 'Quiet'
    })
  })

  it('does not collapse a folder holding the focused idle chat', () => {
    const folderRows = [
      chatRow({ id: 'q1', folder: 'Quiet', tabId: 'a', state: 'idle' }),
      chatRow({ id: 'q2', folder: 'Quiet', tabId: null, state: 'idle' })
    ]
    const items = chatSidebarListItems(
      folderRows,
      stateWith({ groupBy: 'folder', collapseFolders: { idle: true } }),
      '',
      [],
      undefined,
      undefined,
      new Set(['a'])
    )
    expect(items.find((item) => item.kind === 'heading')).toMatchObject({ collapsed: false })
    expect(chatIds(items).sort()).toEqual(['q1', 'q2'])
  })

  it('shows a working or permission chat even when Idle is checked', () => {
    const items = chatSidebarListItems(
      [
        chatRow({ id: 'work', tabId: null, state: 'working' }),
        chatRow({ id: 'perm', tabId: null, state: 'idle', displayState: 'permission' })
      ],
      stateWith({ groupBy: 'status', hideChats: { idle: true } }),
      ''
    )
    expect(chatIds(items).sort()).toEqual(['perm', 'work'])
  })
})
