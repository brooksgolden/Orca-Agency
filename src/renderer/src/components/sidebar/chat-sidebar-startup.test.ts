import { describe, expect, it } from 'vitest'
import type { ChatSidebarSettings } from '../../../../shared/chat-sidebar-settings'
import { buildChatSidebarRows } from './chat-sidebar-rows'
import { chatSidebarPreferencePatch } from './chat-sidebar-identity'
import { chatSession, chatState, chatTab, chatWorktree } from './chat-sidebar-test-fixtures'
import { chatSessionKey } from './chat-sidebar-types'

describe('chat sidebar startup restoration', () => {
  it.each(['history', 'reopened-tab', 'title-only-tab'] as const)(
    'keeps an explicit Done status and activity time when %s metadata advances without a prompt',
    (surface) => {
      const key = chatSessionKey('local', 'codex', 'session-closed')
      const state = chatState()
      state.settings!.chatSidebar = {
        historySince: 0,
        completed: { [key]: { at: 3_000, activityAt: 2_000, done: true } }
      }
      if (surface !== 'history') {
        state.tabsByWorktree[chatWorktree.id] = [chatTab('closed', { createdAt: 9_000 })]
      }
      if (surface === 'title-only-tab') {
        const leafId = '77777777-7777-4777-8777-777777777777'
        state.ptyIdsByTabId = { closed: ['pty-closed'] }
        state.runtimePaneTitlesByTabId = { closed: { 1: 'Codex' } }
        state.terminalLayoutsByTabId = {
          closed: { root: { type: 'leaf', leafId }, activeLeafId: leafId, expandedLeafId: null }
        }
      }
      const rows = buildChatSidebarRows(
        state,
        [
          chatSession('session-closed', {
            updatedAt: new Date(8_000).toISOString(),
            modifiedAt: new Date(8_000).toISOString()
          })
        ],
        10_000
      )
      expect(rows[0]).toMatchObject({ id: key, completed: true, timestamp: 2_000 })
    }
  )

  it('keeps a completed new session separate from the previous session in the same pane', () => {
    const key = chatSessionKey('local', 'codex', 'session-new')
    const previousKey = chatSessionKey('local', 'codex', 'session-previous')
    const paneKey = 'closed:77777777-7777-4777-8777-777777777777'
    const state = chatState({
      tabsByWorktree: {
        [chatWorktree.id]: [
          chatTab('closed', {
            aiVaultTitle: { agent: 'codex', sessionId: 'session-previous', title: 'Previous chat' }
          })
        ]
      },
      agentStatusByPaneKey: {
        [paneKey]: {
          paneKey,
          tabId: 'closed',
          worktreeId: chatWorktree.id,
          state: 'done',
          sessionBoundary: true,
          agentType: 'codex',
          prompt: '',
          stateStartedAt: 10_000,
          updatedAt: 10_000,
          stateHistory: [],
          providerSession: { key: 'session_id', id: 'session-new' }
        }
      }
    })
    state.settings!.chatSidebar = {
      historySince: 0,
      completed: { [key]: { at: 3_000, activityAt: 2_000, done: true } }
    }
    const rows = buildChatSidebarRows(
      state,
      [
        chatSession('session-new', { updatedAt: new Date(8_000).toISOString() }),
        chatSession('session-previous', { updatedAt: new Date(9_000).toISOString() })
      ],
      10_000
    )
    expect(rows.find((row) => row.id === key)).toMatchObject({
      tabId: 'closed',
      completed: true,
      timestamp: 2_000
    })
    expect(rows.find((row) => row.id === previousKey)).toMatchObject({
      tabId: null,
      completed: false
    })
  })

  it.each(['history-first', 'tabs-first'] as const)(
    'preserves existing completion and working state when restoring %s',
    (order) => {
      const workingKey = chatSessionKey('local', 'codex', 'session-working')
      const idleKey = chatSessionKey('local', 'codex', 'session-idle')
      const doneKey = chatSessionKey('local', 'codex', 'session-closed')
      const initial: ChatSidebarSettings = {
        historySince: 0,
        completed: { [doneKey]: { at: 3_000, activityAt: 2_000, done: true } }
      }
      const sessions = [
        chatSession('session-working', { updatedAt: new Date(9_000).toISOString() }),
        chatSession('session-idle'),
        chatSession('session-closed')
      ]
      const state = chatState()
      state.settings!.chatSidebar = initial
      const record = () => {
        const rows = buildChatSidebarRows(state, sessions, 10_000)
        state.settings!.chatSidebar = {
          ...state.settings!.chatSidebar,
          ...chatSidebarPreferencePatch(rows, state.settings!.chatSidebar!, 10_000)
        }
        return rows
      }
      if (order === 'history-first') {
        const beforeTabs = record()
        expect(beforeTabs.find((row) => row.id === workingKey)?.completed).toBe(false)
        expect(beforeTabs.find((row) => row.id === idleKey)?.completed).toBe(false)
        expect(state.settings!.chatSidebar.completed).toEqual(initial.completed)
      }
      state.tabsByWorktree = { [chatWorktree.id]: [chatTab('working'), chatTab('idle')] }
      const withTabs = record()
      expect(withTabs.find((row) => row.id === idleKey)?.completed).toBe(false)
      expect(state.settings!.chatSidebar.completed).toEqual(initial.completed)
      const paneKey = 'working:77777777-7777-4777-8777-777777777777'
      state.agentStatusByPaneKey = {
        [paneKey]: {
          paneKey,
          tabId: 'working',
          worktreeId: chatWorktree.id,
          state: 'working',
          agentType: 'codex',
          prompt: 'Continue the existing turn',
          stateStartedAt: 5_000,
          updatedAt: 9_000,
          stateHistory: [],
          providerSession: { key: 'session_id', id: 'session-working' }
        }
      }
      const restored = record()
      expect(restored[0]).toMatchObject({ id: workingKey, state: 'working', completed: false })
      expect(restored.find((row) => row.id === doneKey)?.completed).toBe(true)
      expect(state.settings!.chatSidebar.completed).toEqual(initial.completed)
      // Reconnect can briefly lose resident rows without meaning the user closed a tab.
      state.tabsByWorktree = {}
      state.agentStatusByPaneKey = {}
      const reconnecting = record()
      expect(reconnecting.find((row) => row.id === workingKey)?.completed).toBe(false)
      expect(reconnecting.find((row) => row.id === idleKey)?.completed).toBe(false)
      expect(state.settings!.chatSidebar.completed).toEqual(initial.completed)
    }
  )

  it('preserves an explicit completion when a restored tab replays its idle session boundary', () => {
    const key = chatSessionKey('local', 'claude', 'session-closed')
    const paneKey = 'closed:77777777-7777-4777-8777-777777777777'
    const state = chatState({
      tabsByWorktree: {
        [chatWorktree.id]: [
          chatTab('closed', {
            launchAgent: 'claude',
            aiVaultTitle: { agent: 'claude', sessionId: 'session-closed', title: 'Closed chat' }
          })
        ]
      },
      agentStatusByPaneKey: {
        [paneKey]: {
          paneKey,
          tabId: 'closed',
          worktreeId: chatWorktree.id,
          state: 'done',
          sessionBoundary: true,
          agentType: 'claude',
          prompt: '',
          stateStartedAt: 10_000,
          updatedAt: 10_000,
          stateHistory: [],
          providerSession: { key: 'session_id', id: 'session-closed' }
        }
      }
    })
    const completed = { [key]: { at: 3_000, activityAt: 2_000, done: true } }
    state.settings!.chatSidebar = { completed }
    const rows = buildChatSidebarRows(
      state,
      [chatSession('session-closed', { agent: 'claude' })],
      10_000
    )
    expect(rows[0]).toMatchObject({ completed: true, timestamp: 2_000 })
    const patch = chatSidebarPreferencePatch(rows, state.settings!.chatSidebar, 10_000)
    expect(patch?.completed ?? completed).toEqual(completed)
  })
})
