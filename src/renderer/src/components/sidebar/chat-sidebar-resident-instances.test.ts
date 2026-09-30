import { describe, expect, it } from 'vitest'
import { makePaneKey } from '../../../../shared/stable-pane-id'
import { buildChatSidebarRows } from './chat-sidebar-rows'
import { chatSidebarListItems } from './chat-sidebar-groups'
import { chatSidebarPreferencePatch, chatCompletionEdit } from './chat-sidebar-identity'
import { chatFallbackId, chatSessionKey } from './chat-sidebar-types'
import { chatSession, chatState, chatTab, chatWorktree } from './chat-sidebar-test-fixtures'

describe('resident copies of a provider session', () => {
  const key = chatSessionKey('local', 'claude', 'shared')
  const session = chatSession('shared', { agent: 'claude' })
  const tab = (id: string) =>
    chatTab(id, {
      launchAgent: 'claude',
      aiVaultTitle: { agent: 'claude', sessionId: 'shared', title: 'Client work' }
    })

  it('keeps each open tab navigable without adding its history as a third row', () => {
    const state = chatState({ tabsByWorktree: { [chatWorktree.id]: [tab('a'), tab('b')] } })
    state.settings!.chatSidebar = { historySince: 0 }
    const rows = buildChatSidebarRows(state, [session], 10_000)
    expect(rows.map((row) => row.tabId).sort()).toEqual(['a', 'b'])
    expect(new Set(rows.map((row) => row.id)).size).toBe(2)
    expect(rows.every((row) => row.sessionKey === key)).toBe(true)
    expect(
      chatSidebarListItems(rows, state, '')
        .filter((item) => item.kind === 'chat')
        .map((item) => item.subTab)
    ).toEqual([false, true])

    const secondId = rows.find((row) => row.tabId === 'b')!.id
    state.settings!.chatSidebar.titles = { [key]: 'Client work', [secondId]: 'Second terminal' }
    state.settings!.chatSidebar.completed = {
      [key]: { at: 4_000, activityAt: 2_000, done: false },
      [secondId]: { at: 5_000, activityAt: 2_000 }
    }
    const renamed = buildChatSidebarRows(state, [session], 10_000)
    expect(renamed.find((row) => row.tabId === 'a')).toMatchObject({
      title: 'Client work',
      completed: false
    })
    expect(renamed.find((row) => row.tabId === 'b')).toMatchObject({
      title: 'Second terminal',
      completed: true
    })
    const patch = chatSidebarPreferencePatch(renamed, state.settings!.chatSidebar, 10_000)
    expect(patch?.titles).toBeUndefined()
    expect(patch?.completed).toBeUndefined()

    state.tabsByWorktree[chatWorktree.id] = [tab('b')]
    expect(buildChatSidebarRows(state, [session], 10_000)).toMatchObject([
      { tabId: 'b', title: 'Second terminal', completed: true }
    ])
    const promoted = buildChatSidebarRows(state, [session], 10_000)
    const promotion = chatSidebarPreferencePatch(promoted, state.settings!.chatSidebar, 10_000)
    expect(promotion?.titles).toBeUndefined()
    expect(promotion?.completed).toBeUndefined()
    const toggled = {
      ...state.settings!.chatSidebar,
      ...chatCompletionEdit(promoted[0], state.settings!.chatSidebar, false, 11_000)
    }
    expect(toggled.completed?.[secondId]).toBeUndefined()
    const originalSettings = state.settings!.chatSidebar
    state.settings!.chatSidebar = toggled
    expect(buildChatSidebarRows(state, [session], 11_000)[0].completed).toBe(false)
    state.settings!.chatSidebar = originalSettings
    state.settings!.chatSidebar = { ...state.settings!.chatSidebar, ...promotion }
    state.tabsByWorktree[chatWorktree.id] = [tab('a'), tab('b')]
    const restored = buildChatSidebarRows(state, [session], 10_000)
    expect(restored.find((row) => row.tabId === 'a')?.title).toBe('Client work')
    expect(restored.find((row) => row.tabId === 'b')?.title).toBe('Second terminal')
    state.tabsByWorktree = {}
    expect(buildChatSidebarRows(state, [session], 10_000)).toMatchObject([{ tabId: null }])
  })

  it('keeps two panes sharing a session distinct and honors session-wide hiding', () => {
    const paneA = makePaneKey('a', '77777777-7777-4777-8777-777777777777')
    const paneB = makePaneKey('a', '88888888-8888-4888-8888-888888888888')
    const state = chatState({ tabsByWorktree: { [chatWorktree.id]: [tab('a')] } })
    for (const paneKey of [paneA, paneB]) {
      state.agentStatusByPaneKey[paneKey] = {
        paneKey,
        state: 'done',
        stateStartedAt: 3_000,
        updatedAt: 3_000,
        stateHistory: [],
        prompt: 'Client work',
        agentType: 'claude',
        providerSession: { key: 'session_id', id: 'shared' }
      }
    }
    const rows = buildChatSidebarRows(state, [session], 10_000)
    expect(rows.map((row) => row.paneKey).sort()).toEqual([paneA, paneB].sort())
    expect(new Set(rows.map((row) => row.id)).size).toBe(2)
    expect(rows.some((row) => row.id === chatFallbackId('local', paneB))).toBe(true)
    state.settings!.chatSidebar = { hidden: [key], historySince: 0 }
    expect(buildChatSidebarRows(state, [session], 10_000)).toEqual([])
    state.settings!.chatSidebar = { automationChats: [key], historySince: 0 }
    expect(buildChatSidebarRows(state, [session], 10_000)).toEqual([])
  })

  it('does not swap resident identities when the other copy starts working', () => {
    const state = chatState({ tabsByWorktree: { [chatWorktree.id]: [tab('a'), tab('b')] } })
    for (const id of ['a', 'b']) {
      const paneKey = makePaneKey(id, '77777777-7777-4777-8777-777777777777')
      state.agentStatusByPaneKey[paneKey] = {
        paneKey,
        state: 'done',
        stateStartedAt: 3_000,
        updatedAt: 3_000,
        stateHistory: [],
        prompt: 'Client work',
        agentType: 'claude',
        providerSession: { key: 'session_id', id: 'shared' }
      }
    }
    const identities = () =>
      Object.fromEntries(
        buildChatSidebarRows(state, [session], 10_000).map((row) => [row.tabId, row.id])
      )
    const before = identities()
    const second =
      state.agentStatusByPaneKey[makePaneKey('b', '77777777-7777-4777-8777-777777777777')]
    second.state = 'working'
    second.stateStartedAt = 8_000
    expect(identities()).toEqual(before)
  })

  it('settles registry writes with the same session open in two workspaces', () => {
    const other = { ...chatWorktree, id: 'other' }
    const state = chatState({
      worktreesByRepo: { repo: [chatWorktree, other] },
      tabsByWorktree: {
        [chatWorktree.id]: [tab('a')],
        other: [{ ...tab('b'), worktreeId: 'other' }]
      }
    })
    const rows = buildChatSidebarRows(state, [session], 10_000)
    const initial = chatSidebarPreferencePatch(rows, {}, 10_000)!
    expect(initial.sessions?.[key].worktreeId).toBe(chatWorktree.id)
    expect(chatSidebarPreferencePatch(rows.toReversed(), initial, 10_000)).toBeNull()
  })
})
