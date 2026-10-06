import { describe, expect, it } from 'vitest'
import { chatSidebarListItems } from './chat-sidebar-groups'
import { chatRow, chatState, chatTab, chatWorktree } from './chat-sidebar-test-fixtures'
import type { ChatSidebarSettings } from '../../../../shared/chat-sidebar-settings'

const rows = [
  chatRow({ id: 'open', tabId: 'a', state: 'idle' }),
  chatRow({ id: 'closed', tabId: null }),
  chatRow({ id: 'done', folder: 'Finished', tabId: null, completed: true }),
  chatRow({ id: 'open-done', folder: 'Finished', tabId: 'b', completed: true })
].map((row) => ({ ...row, title: row.id }))

function items(settings: ChatSidebarSettings, query = '', collapsed = new Set<string>()) {
  const state = chatState({
    tabsByWorktree: { [chatWorktree.id]: [chatTab('a'), chatTab('b')] }
  })
  return chatSidebarListItems(
    rows,
    { ...state, settings: { ...state.settings!, chatSidebar: settings } },
    query,
    [],
    collapsed
  )
}

describe('chat sidebar folder filters', () => {
  it.each(['folder', 'status', 'recent'] as const)(
    'only-open filtering keeps resident idle and Done tabs under %s grouping',
    (groupBy) => {
      expect(
        items({ groupBy, showOnlyOpenChats: true })
          .filter((item) => item.kind === 'chat')
          .map((item) => item.id)
      ).toEqual(['open', 'open-done'])
      expect(
        items({ groupBy, showOnlyOpenChats: true, showOnlyInProgress: true })
          .filter((item) => item.kind === 'chat')
          .map((item) => item.id)
      ).toEqual(['open'])
    }
  )

  it('automatically collapses only folders whose full membership is marked Done', () => {
    const settings = { groupBy: 'folder', collapseDoneFolders: true } as const
    const result = items(settings)
    expect(result.find((item) => item.id === 'chat:folder:Finished')).toMatchObject({
      collapsed: true,
      doneFolder: 'Finished',
      label: 'Finished (2)'
    })
    expect(result.find((item) => item.id === 'chat:folder:Acme')).toMatchObject({
      collapsed: false
    })
    expect(result.filter((item) => item.kind === 'chat').map((item) => item.id)).toEqual([
      'closed',
      'open'
    ])
    expect(items(settings, 'open-done')[0]).toMatchObject({ collapsed: true })
    expect(items(settings, 'closed')[0]).toMatchObject({ collapsed: false })
  })

  it('does not mistake a search result or only-open subset for an entirely Done folder', () => {
    const state = chatState()
    const mixed = rows.map((row) => ({ ...row, folder: 'Acme' }))
    const result = chatSidebarListItems(
      mixed,
      {
        ...state,
        settings: {
          ...state.settings!,
          chatSidebar: { groupBy: 'folder', collapseDoneFolders: true }
        }
      },
      'open-done'
    )
    expect(result[0]).toMatchObject({ collapsed: false })
    expect(result.some((item) => item.kind === 'chat' && item.id === 'open-done')).toBe(true)
  })

  it('allows manually expanding Done folders and preserves existing manual collapse preferences', () => {
    const settings = {
      groupBy: 'folder',
      collapseDoneFolders: true,
      expandedDoneFolders: ['Finished']
    } as const
    expect(
      items({ ...settings, expandedDoneFolders: [...settings.expandedDoneFolders] })
    ).toHaveLength(6)
    expect(
      items(
        { ...settings, expandedDoneFolders: [...settings.expandedDoneFolders] },
        '',
        new Set(['chat:folder:Acme'])
      )
        .filter((item) => item.kind === 'chat')
        .map((item) => item.id)
    ).toEqual(['done', 'open-done'])
    expect(items({ groupBy: 'folder', collapseDoneFolders: false })).toHaveLength(6)
    expect(items({ groupBy: 'status', collapseDoneFolders: true })[0]).toMatchObject({
      label: 'In Progress (3)',
      collapsed: false
    })
    expect(items({ groupBy: 'status' }, '', new Set(['chat:status:In progress']))[0]).toMatchObject(
      {
        label: 'In Progress (3)',
        collapsed: true
      }
    )
  })

  it('expands automatically when a Done folder acquires a chat still being reviewed', () => {
    const state = chatState()
    const result = chatSidebarListItems(
      rows.map((row) =>
        row.id === 'done' ? { ...row, completed: false, state: 'idle' as const } : row
      ),
      {
        ...state,
        settings: {
          ...state.settings!,
          chatSidebar: { groupBy: 'folder', collapseDoneFolders: true }
        }
      },
      ''
    )
    expect(result.find((item) => item.id === 'chat:folder:Finished')).toMatchObject({
      collapsed: false
    })
    expect(result.some((item) => item.kind === 'chat' && item.id === 'done')).toBe(true)
  })
})
