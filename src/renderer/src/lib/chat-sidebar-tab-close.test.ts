import { describe, expect, it } from 'vitest'
import { closedChatSidebarPatch } from './chat-sidebar-tab-close'
import { chatSidebarPreferencePatch } from '@/components/sidebar/chat-sidebar-identity'
import { buildChatSidebarRows } from '@/components/sidebar/chat-sidebar-rows'
import { chatSidebarListItems } from '@/components/sidebar/chat-sidebar-groups'
import {
  chatRow,
  chatSession,
  chatState,
  chatTab,
  chatWorktree
} from '@/components/sidebar/chat-sidebar-test-fixtures'

describe('closed chat sidebar lifecycle', () => {
  it('preserves existing history status until the user closes or completes a chat', () => {
    const session = chatSession('session-b')
    const state = chatState()
    state.settings!.chatSidebar = { historySince: 0 }
    const saved = buildChatSidebarRows(state, [session], 10_000)
    expect(saved[0].completed).toBe(false)
    state.settings!.chatSidebar = {
      ...state.settings!.chatSidebar,
      ...chatSidebarPreferencePatch(saved, state.settings!.chatSidebar, 10_000)
    }
    state.tabsByWorktree[chatWorktree.id] = [chatTab('b', { createdAt: 10_000 })]
    const resumed = buildChatSidebarRows(state, [session], 10_000)
    expect(resumed[0]).toMatchObject({ completed: false, timestamp: 2_000 })
    expect(state.settings!.chatSidebar.completed).toBeUndefined()
  })
  it('keeps closed chats as separate Done entries without changing their activity time', () => {
    const session = chatSession('session-b')
    const state = chatState({ tabsByWorktree: { [chatWorktree.id]: [chatTab('a'), chatTab('b')] } })
    const before = buildChatSidebarRows(state, [session], 10_000)
    const closing = before.filter((row) => row.tabId === 'b')
    state.tabsByWorktree[chatWorktree.id] = [chatTab('a')]
    state.settings!.chatSidebar = closedChatSidebarPatch(
      closing,
      before.filter((row) => row.tabId !== 'b'),
      {},
      10_000
    )
    const rows = buildChatSidebarRows(state, [session], 10_000)
    const saved = rows.find((row) => row.sessionKey === closing[0].sessionKey)!
    expect(saved).toMatchObject({ tabId: null, completed: true, timestamp: 2_000 })
    expect(
      chatSidebarListItems(rows, state, '').find((item) => item.id === saved.id)
    ).toMatchObject({ subTab: false })
    expect(
      chatSidebarListItems(rows, state, '').some(
        (item) => item.kind === 'heading' && item.label === 'Done (1)'
      )
    ).toBe(true)
    state.tabsByWorktree[chatWorktree.id].push(chatTab('b'))
    expect(
      buildChatSidebarRows(state, [session], 11_000).find((row) => row.tabId === 'b')?.completed
    ).toBe(true)
  })

  it('does not mark a still-open duplicate done', () => {
    const a = chatRow(),
      b = chatRow({ tabId: 'b', id: 'duplicate' })
    expect(closedChatSidebarPatch([a], [b], {}, 10_000).completed).toEqual({})
    expect(closedChatSidebarPatch([b], [], {}, 11_000).completed?.[a.id].done).toBe(true)
  })
})
