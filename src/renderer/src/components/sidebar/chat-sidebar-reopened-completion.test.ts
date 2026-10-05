import { describe, expect, it } from 'vitest'
import { makePaneKey } from '../../../../shared/stable-pane-id'
import { placeWorkspaceAtEdge } from '@/lib/workspace-split-layout'
import { closedChatSidebarPatch } from '@/lib/chat-sidebar-tab-close'
import { buildChatSidebarRows } from './chat-sidebar-rows'
import { chatSidebarListItems } from './chat-sidebar-groups'
import { chatSidebarPreferencePatch, chatCompletionEdit } from './chat-sidebar-identity'
import { chatCompletionActivityTime } from './chat-sidebar-completion'
import { chatSessionKey } from './chat-sidebar-types'
import {
  chatRow,
  chatSession,
  chatState,
  chatTab,
  chatWorktree
} from './chat-sidebar-test-fixtures'

const sessionId = '99999999-9999-4999-8999-999999999999'
const sessionKey = chatSessionKey('local', 'claude', sessionId)
const paneKey = makePaneKey('reopened', '77777777-7777-4777-8777-777777777777')
const session = chatSession(sessionId, {
  agent: 'claude',
  title: 'Client app update',
  filePath: '/claude/projects/-clients-Acme/99999999.jsonl',
  lastHumanTurnAt: new Date(1_500).toISOString()
})

function reopenedState() {
  const closing = chatRow({
    id: sessionKey,
    sessionKey,
    session,
    tabId: 'closed',
    timestamp: 2_000
  })
  const state = chatState({
    tabsByWorktree: {
      [chatWorktree.id]: [
        chatTab('reopened', {
          createdAt: 9_000,
          launchAgent: 'claude',
          aiVaultTitle: { agent: 'claude', sessionId, title: session.title }
        })
      ]
    },
    agentStatusByPaneKey: {
      [paneKey]: {
        paneKey,
        tabId: 'reopened',
        worktreeId: chatWorktree.id,
        agentType: 'claude',
        state: 'done',
        sessionBoundary: true,
        stateStartedAt: 11_000,
        updatedAt: 11_000,
        stateHistory: [],
        prompt: '',
        providerSession: { key: 'session_id', id: sessionId, transcriptPath: session.filePath }
      }
    }
  })
  // The old close may finish saving after the replacement tab has already opened.
  state.settings!.chatSidebar = closedChatSidebarPatch([closing], [], {}, 10_000)
  return state
}

describe('resuming a chat previously completed by tab close', () => {
  it('ignores resume metadata writes before and after saving the reopened status', () => {
    const state = reopenedState()
    const touched = { ...session, updatedAt: new Date(12_500).toISOString() }
    const rows = buildChatSidebarRows(state, [touched], 13_000)
    expect(rows[0]).toMatchObject({ completed: false, timestamp: 2_000 })
    const patch = chatSidebarPreferencePatch(rows, state.settings!.chatSidebar!, 13_000)
    state.settings!.chatSidebar = { ...state.settings!.chatSidebar, ...patch }
    expect(buildChatSidebarRows(state, [], 14_000)[0]).toMatchObject({
      completed: false,
      timestamp: 2_000
    })
  })

  it('returns the replacement tab to In Progress without changing its activity time', () => {
    const state = reopenedState()
    const rows = buildChatSidebarRows(state, [session], 11_000)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ tabId: 'reopened', completed: false, timestamp: 2_000 })
    const patch = chatSidebarPreferencePatch(rows, state.settings!.chatSidebar!, 11_000)
    expect(patch?.completed?.[sessionKey]).toMatchObject({ done: false, activityAt: 2_000 })
    state.settings!.chatSidebar = { ...state.settings!.chatSidebar, ...patch }
    expect(buildChatSidebarRows(state, [], 12_000)[0].completed).toBe(false)
  })

  it('brackets the reopened chat with the other visible workspace immediately', () => {
    const state = reopenedState()
    const [reopened] = buildChatSidebarRows(state, [session], 11_000)
    const other = chatRow({
      id: 'other',
      tabId: 'other',
      worktree: { ...chatWorktree, id: 'other' }
    })
    const splits = placeWorkspaceAtEdge([], other.worktree.id, chatWorktree.id, 'right', 'split')
    const items = chatSidebarListItems([reopened, other], state, '', splits)
    expect(items.filter((item) => item.kind === 'heading').map((item) => item.label)).toEqual([
      'In progress (2)'
    ])
    expect(items.filter((item) => item.kind === 'chat').map((item) => item.splitId)).toEqual([
      'split',
      'split'
    ])
  })

  it('preserves an explicit Mark done choice on an open tab', () => {
    const state = reopenedState()
    state.settings!.chatSidebar!.completed = {
      [sessionKey]: { done: true, at: 10_000, activityAt: 2_000 }
    }
    expect(buildChatSidebarRows(state, [session], 11_000)[0].completed).toBe(true)
  })

  it('keeps a prompted legacy Done chat in a three-pane bracket after the working event ends', () => {
    const state = reopenedState()
    state.settings!.chatSidebar!.completed = {
      [sessionKey]: { done: true, at: 10_000, activityAt: 2_000 }
    }
    const entry = state.agentStatusByPaneKey[paneKey]
    Object.assign(entry, {
      state: 'working',
      sessionBoundary: false,
      stateStartedAt: 12_000,
      prompt: 'Continue the work'
    })
    const prompted = buildChatSidebarRows(state, [session], 12_000)
    const patch = chatSidebarPreferencePatch(prompted, state.settings!.chatSidebar!, 12_000)
    expect(patch?.completed?.[sessionKey]?.done).toBe(false)
    state.settings!.chatSidebar = { ...state.settings!.chatSidebar, ...patch }
    Object.assign(entry, {
      state: 'done',
      sessionBoundary: true,
      stateStartedAt: 14_000,
      stateHistory: [],
      prompt: ''
    })
    const [restored] = buildChatSidebarRows(state, [], 14_000)
    const siblings = ['coding', 'third'].map((id) =>
      chatRow({
        id,
        sessionKey: null,
        aliases: [],
        tabId: id,
        worktree: { ...chatWorktree, id }
      })
    )
    const split = placeWorkspaceAtEdge([], chatWorktree.id, 'coding', 'right', 'visible')
    const threePanes = placeWorkspaceAtEdge(split, 'third', 'coding', 'bottom', 'visible')
    const items = chatSidebarListItems([restored, ...siblings], state, '', threePanes)
    expect(items.filter((item) => item.kind === 'heading').map((item) => item.label)).toEqual([
      'In progress (3)'
    ])
    expect(items.filter((item) => item.kind === 'chat').map((item) => item.splitId)).toEqual([
      'visible',
      'visible',
      'visible'
    ])
  })

  it('preserves explicit Mark done through closing and resuming until the next prompt', () => {
    const state = reopenedState()
    const [open] = buildChatSidebarRows(state, [session], 11_000)
    state.settings!.chatSidebar = {
      ...state.settings!.chatSidebar,
      ...chatCompletionEdit(open, state.settings!.chatSidebar!, true, 11_000)
    }
    const [marked] = buildChatSidebarRows(state, [session], 12_000)
    const chosen = state.settings!.chatSidebar!.completed?.[sessionKey]
    state.settings!.chatSidebar = {
      ...state.settings!.chatSidebar,
      ...closedChatSidebarPatch([marked], [], state.settings!.chatSidebar!, 12_000)
    }
    expect(state.settings!.chatSidebar!.completed?.[sessionKey]).toEqual(chosen)
    state.tabsByWorktree[chatWorktree.id] = [
      chatTab('replacement', {
        launchAgent: 'claude',
        aiVaultTitle: { agent: 'claude', sessionId, title: session.title }
      })
    ]
    state.agentStatusByPaneKey = {}
    expect(buildChatSidebarRows(state, [session], 13_000)[0]).toMatchObject({
      completed: true,
      timestamp: 2_000
    })
    const prompted = {
      ...session,
      lastHumanTurnAt: new Date(14_000).toISOString(),
      updatedAt: new Date(14_500).toISOString()
    }
    expect(buildChatSidebarRows(state, [prompted], 15_000)[0]).toMatchObject({
      completed: false,
      timestamp: 14_500
    })
  })

  it('clears a reopened title-only chat marker on a later working state', () => {
    const completion = { activityAt: 2_000, at: 10_000, done: false, closedTabId: 'closed' }
    const row = chatRow({
      id: sessionKey,
      sessionKey,
      tabId: 'reopened',
      turnStartedAt: 0,
      activityFromState: true,
      state: 'working',
      timestamp: 12_000
    })
    expect(chatCompletionActivityTime(row, completion)).toBe(12_000)
    const patch = chatSidebarPreferencePatch(
      [row],
      { completed: { [sessionKey]: completion } },
      12_000
    )
    expect(patch?.completed?.[sessionKey]).toMatchObject({ done: false, at: 12_000 })
    expect(patch?.completed?.[sessionKey].closedTabId).toBeUndefined()
    expect(
      chatCompletionActivityTime(
        { ...row, state: 'idle', timestamp: 12_500 },
        patch?.completed?.[sessionKey]
      )
    ).toBe(12_500)
    expect(chatSidebarPreferencePatch([row], { ...patch }, 13_000)).toBeNull()
  })

  it('uses a real prompt in the transcript when a quick turn has no retained working history', () => {
    const state = reopenedState()
    state.settings!.chatSidebar!.completed = {
      [sessionKey]: { done: true, at: 10_000, activityAt: 2_000 }
    }
    const prompted = {
      ...session,
      lastHumanTurnAt: new Date(12_000).toISOString(),
      updatedAt: new Date(12_500).toISOString()
    }
    const rows = buildChatSidebarRows(state, [prompted], 13_000)
    expect(rows[0]).toMatchObject({ completed: false, turnStartedAt: 12_000, timestamp: 12_500 })
    const patch = chatSidebarPreferencePatch(rows, state.settings!.chatSidebar!, 13_000)
    expect(patch?.completed?.[sessionKey]?.done).toBe(false)
  })

  it('uses a real transcript prompt before hooks reconnect to the replacement tab', () => {
    const state = reopenedState()
    state.agentStatusByPaneKey = {}
    const prompted = {
      ...session,
      lastHumanTurnAt: new Date(12_000).toISOString(),
      updatedAt: new Date(12_500).toISOString()
    }
    const rows = buildChatSidebarRows(state, [prompted], 13_000)
    expect(rows[0]).toMatchObject({
      completed: false,
      state: 'idle',
      turnStartedAt: 12_000,
      timestamp: 12_500
    })
    const patch = chatSidebarPreferencePatch(rows, state.settings!.chatSidebar!, 13_000)
    expect(patch?.completed?.[sessionKey]?.closedTabId).toBeUndefined()
    state.settings!.chatSidebar = { ...state.settings!.chatSidebar, ...patch }
    const [restored] = buildChatSidebarRows(state, [], 14_000)
    expect(restored).toMatchObject({ completed: false, timestamp: 12_500 })
  })

  it('does not treat a resume timestamp or a harness notification as a new prompt', () => {
    const state = reopenedState()
    state.settings!.chatSidebar!.completed = {
      [sessionKey]: { done: true, at: 10_000, activityAt: 2_000 }
    }
    const touched = { ...session, updatedAt: new Date(12_500).toISOString() }
    expect(buildChatSidebarRows(state, [touched], 13_000)[0].completed).toBe(true)
  })
})
