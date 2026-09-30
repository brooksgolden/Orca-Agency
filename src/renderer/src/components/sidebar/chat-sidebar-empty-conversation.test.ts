import { describe, expect, it } from 'vitest'
import { buildChatSidebarRows } from './chat-sidebar-rows'
import { chatSidebarPreferencePatch } from './chat-sidebar-identity'
import { closedChatSidebarPatch } from '@/lib/chat-sidebar-tab-close'
import { chatSessionKey } from './chat-sidebar-types'
import { chatSession, chatState, chatTab, chatWorktree } from './chat-sidebar-test-fixtures'

function freshChat(agent: 'claude' | 'codex') {
  const paneKey = 'empty:77777777-7777-4777-8777-777777777777'
  const state = chatState({
    tabsByWorktree: {
      [chatWorktree.id]: [
        chatTab('empty', {
          launchAgent: agent,
          title: agent,
          aiVaultTitle: null,
          customTitle: 'User label'
        })
      ]
    },
    agentStatusByPaneKey: {
      [paneKey]: {
        paneKey,
        tabId: 'empty',
        worktreeId: chatWorktree.id,
        agentType: agent,
        state: agent === 'codex' ? 'working' : 'done',
        prompt: '',
        stateHistory: [],
        stateStartedAt: 1_000,
        updatedAt: 1_000,
        sessionBoundary: agent === 'claude',
        providerSession: {
          key: 'session_id',
          id: 'empty-session',
          transcriptPath:
            agent === 'claude'
              ? '/home/.claude/projects/-clients-Acme/empty-session.jsonl'
              : '/home/.codex/sessions/2026/09/30/rollout.jsonl'
        }
      }
    }
  })
  return {
    state,
    entry: state.agentStatusByPaneKey[paneKey],
    key: chatSessionKey('local', agent, 'empty-session')
  }
}

describe('unprompted agent tabs', () => {
  it('does not borrow conversation evidence from a previous session after /clear', () => {
    const { state, entry } = freshChat('claude')
    entry.stateHistory = [{ state: 'working', prompt: 'Old conversation', startedAt: 500 }]
    entry.lastCompletedAssistantMessage = 'Old reply'
    entry.prompt = 'Old prompt carried across boundary'
    const rows = buildChatSidebarRows(state, [], 2_000)
    expect(rows).toEqual([])
    expect(chatSidebarPreferencePatch(rows, {}, 2_000, { liveOnly: true })).toBeNull()
  })

  it('does not treat a title-only idle agent label as a user prompt', () => {
    const { state } = freshChat('claude')
    const leafId = '77777777-7777-4777-8777-777777777777'
    state.agentStatusByPaneKey = {}
    state.ptyIdsByTabId = { empty: ['pty-empty'] }
    state.runtimePaneTitlesByTabId = { empty: { 1: 'Claude Code' } }
    state.terminalLayoutsByTabId = {
      empty: { root: { type: 'leaf', leafId }, activeLeafId: leafId, expandedLeafId: null }
    }
    expect(buildChatSidebarRows(state, [], 2_000)).toEqual([])
  })

  it('keeps a slept agent conversation from its saved prompt before scanning', () => {
    const { state, entry } = freshChat('claude')
    state.agentStatusByPaneKey = {}
    state.sleepingAgentSessionsByPaneKey = {
      [entry.paneKey]: {
        paneKey: entry.paneKey,
        tabId: 'empty',
        worktreeId: chatWorktree.id,
        agent: 'claude',
        providerSession: entry.providerSession!,
        prompt: 'Real work',
        state: 'done',
        capturedAt: 2_000,
        updatedAt: 2_000
      }
    }
    expect(buildChatSidebarRows(state, [], 3_000)).toHaveLength(1)
  })
  it.each(['claude', 'codex'] as const)(
    'does not list or save %s startup, even when manually named',
    (agent) => {
      const { state } = freshChat(agent)
      const rows = buildChatSidebarRows(state, [], 2_000)
      expect(rows).toEqual([])
      expect(chatSidebarPreferencePatch(rows, {}, 2_000, { liveOnly: true })).toBeNull()
      state.tabsByWorktree = {}
      const patch = closedChatSidebarPatch(rows, [], {}, 2_000)
      expect(patch.sessions).toBeUndefined()
      expect(patch.completed).toEqual({})
      expect(buildChatSidebarRows(state, [], 3_000)).toEqual([])
    }
  )

  it.each(['claude', 'codex'] as const)(
    'records %s on the first prompt and preserves it as Done on close',
    (agent) => {
      const { state, entry, key } = freshChat(agent)
      entry.prompt = 'Explain the contract'
      entry.state = 'working'
      entry.sessionBoundary = undefined
      entry.stateStartedAt = 3_000
      const rows = buildChatSidebarRows(state, [], 3_000)
      expect(rows).toHaveLength(1)
      const recorded = chatSidebarPreferencePatch(rows, {}, 3_000, { liveOnly: true })!
      expect(recorded.sessions?.[key].snapshot).toBeDefined()
      state.settings!.chatSidebar = recorded
      const closing = buildChatSidebarRows(state, [], 4_000)
      state.tabsByWorktree = {}
      state.agentStatusByPaneKey = {}
      state.settings!.chatSidebar = {
        ...recorded,
        ...closedChatSidebarPatch(closing, [], recorded, 4_000)
      }
      expect(buildChatSidebarRows(state, [], 5_000)).toMatchObject([
        { tabId: null, completed: true }
      ])
    }
  )

  it('keeps real conversations even if the provider title is New chat', () => {
    const { state } = freshChat('claude')
    const session = chatSession('empty-session', { agent: 'claude', title: 'New chat' })
    expect(buildChatSidebarRows(state, [session], 2_000)).toHaveLength(1)
  })

  it('does not hide a real saved chat while the transcript scan is unavailable', () => {
    const { state, entry } = freshChat('claude')
    entry.prompt = 'Work'
    entry.sessionBoundary = undefined
    state.settings!.chatSidebar = chatSidebarPreferencePatch(
      buildChatSidebarRows(state, [], 2_000),
      {},
      2_000
    )!
    entry.prompt = ''
    expect(buildChatSidebarRows(state, [], 3_000)).toHaveLength(1)
  })
})
