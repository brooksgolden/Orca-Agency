import { describe, expect, it } from 'vitest'
import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import { buildChatSidebarRows } from './chat-sidebar-rows'
import { chatSidebarPreferencePatch } from './chat-sidebar-identity'
import { chatSession, chatState, chatTab, chatWorktree } from './chat-sidebar-test-fixtures'
import { chatSessionKey } from './chat-sidebar-types'

describe('opening a chat without submitting a prompt', () => {
  it.each(['claude'] as const)(
    'keeps %s resume and reconnect out of activity ordering',
    (agent) => {
      const key = 'old:77777777-7777-4777-8777-777777777777'
      const session = chatSession('session-old', {
        agent,
        filePath:
          agent === 'claude'
            ? '/claude/projects/-clients-Acme/session-old.jsonl'
            : '/codex/sessions/2026/09/29/session-old.jsonl'
      })
      const recent = chatSession('session-recent', { updatedAt: new Date(5_000).toISOString() })
      const entry: AgentStatusEntry = {
        paneKey: key,
        tabId: 'old',
        worktreeId: chatWorktree.id,
        state: 'done',
        sessionBoundary: true,
        prompt: '',
        agentType: agent,
        stateStartedAt: 10_000,
        updatedAt: 10_000,
        stateHistory: [],
        providerSession: {
          key: 'session_id',
          id: session.sessionId,
          transcriptPath: session.filePath
        }
      }
      const state = chatState({
        tabsByWorktree: {
          [chatWorktree.id]: [
            chatTab('old', {
              createdAt: 10_000,
              launchAgent: agent,
              aiVaultTitle: { agent, sessionId: session.sessionId, title: session.title }
            }),
            chatTab('recent')
          ]
        },
        agentStatusByPaneKey: { [key]: entry }
      })
      const sessionKey = chatSessionKey('local', agent, session.sessionId)
      const opened = buildChatSidebarRows(state, [session, recent], 10_000)
      expect(opened.map((row) => row.tabId)).toEqual(['recent', 'old'])
      expect(opened[1]).toMatchObject({ timestamp: 2_000, turnStartedAt: 0 })
      const saved = chatSidebarPreferencePatch(opened, {}, 10_000)
      expect(Date.parse(saved!.sessions![sessionKey].snapshot!.updatedAt!)).toBe(2_000)
      entry.updatedAt = 20_000
      expect(buildChatSidebarRows(state, [session, recent], 20_000)[1].timestamp).toBe(2_000)

      entry.state = 'working'
      entry.sessionBoundary = false
      entry.stateStartedAt = 21_000
      entry.prompt = 'Continue this task'
      const prompted = buildChatSidebarRows(state, [session, recent], 21_000)
      expect(prompted[0]).toMatchObject({ tabId: 'old', timestamp: 21_000, state: 'working' })

      entry.state = 'done'
      entry.stateStartedAt = 22_000
      expect(buildChatSidebarRows(state, [session, recent], 22_000)[0].timestamp).toBe(22_000)
      entry.sessionBoundary = true
      entry.stateHistory = [{ state: 'done', startedAt: 22_000, prompt: entry.prompt }]
      entry.stateStartedAt = 30_000
      expect(buildChatSidebarRows(state, [session, recent], 30_000)[0].timestamp).toBe(22_000)
    }
  )

  it('keeps an idle Codex resume in place before its first prompt emits a hook', () => {
    const state = chatState({
      tabsByWorktree: {
        [chatWorktree.id]: [chatTab('old', { createdAt: 10_000 }), chatTab('recent')]
      }
    })
    const sessions = [
      chatSession('session-old'),
      chatSession('session-recent', {
        updatedAt: new Date(5_000).toISOString()
      })
    ]
    for (const now of [10_000, 20_000]) {
      const rows = buildChatSidebarRows(state, sessions, now)
      expect(rows.map((row) => row.tabId)).toEqual(['recent', 'old'])
      expect(rows[1]).toMatchObject({ timestamp: 2_000, state: 'idle' })
    }
  })
})
