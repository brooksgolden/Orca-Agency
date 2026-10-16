import { describe, expect, it } from 'vitest'
import { buildChatSidebarRows } from './chat-sidebar-rows'
import { chatSidebarPreferencePatch } from './chat-sidebar-identity'
import { chatFallbackId, chatSessionKey } from './chat-sidebar-types'
import { chatState, chatTab, chatSession, chatWorktree } from './chat-sidebar-test-fixtures'

describe('automation runs in Chats', () => {
  it('never lists a workspace created by an automation before the provider hook arrives', () => {
    const automatedWorktree = {
      ...chatWorktree,
      automationProvenance: {
        kind: 'created-by-automation' as const,
        automationId: 'automation',
        automationNameSnapshot: 'Nightly review',
        automationRunId: 'run',
        automationRunTitleSnapshot: 'Nightly review run',
        createdAt: 1,
        executionTargetType: 'local' as const,
        executionTargetId: 'local',
        projectId: 'repo'
      }
    }
    const state = chatState({
      worktreesByRepo: { repo: [automatedWorktree] },
      tabsByWorktree: { [automatedWorktree.id]: [chatTab('scheduled')] }
    })
    expect(buildChatSidebarRows(state, [], 5_000)).toEqual([])
  })

  it('hides a scheduled tab without hiding a manual sibling in the same workspace', () => {
    const state = chatState({
      tabsByWorktree: { [chatWorktree.id]: [chatTab('scheduled'), chatTab('manual')] }
    })
    state.settings!.chatSidebar = { automationChats: [chatFallbackId('local', 'scheduled')] }
    expect(buildChatSidebarRows(state, [], 5_000).map((row) => row.tabId)).toEqual(['manual'])
  })

  it('remembers the provider identity after automation cleanup removes its tab', () => {
    const state = chatState({ tabsByWorktree: { [chatWorktree.id]: [chatTab('scheduled')] } })
    const current = { automationChats: [chatFallbackId('local', 'scheduled')], historySince: 0 }
    state.settings!.chatSidebar = current
    const session = chatSession('session-scheduled')
    const raw = buildChatSidebarRows(state, [session], 5_000, undefined, true)
    const patch = chatSidebarPreferencePatch(raw, current, 5_000)
    expect(patch?.automationChats).toContain(chatSessionKey('local', 'codex', session.sessionId))
    state.settings!.chatSidebar = { ...current, ...patch }
    state.tabsByWorktree = {}
    expect(buildChatSidebarRows(state, [session], 6_000)).toEqual([])
    expect(buildChatSidebarRows(state, [], 6_000)).toEqual([])
  })

  it('does not hide the same provider identity on another host', () => {
    const state = chatState({ tabsByWorktree: { [chatWorktree.id]: [chatTab('scheduled')] } })
    state.settings!.chatSidebar = {
      automationChats: [chatSessionKey('ssh:other', 'codex', 'session-scheduled')]
    }
    expect(buildChatSidebarRows(state, [], 5_000)).toHaveLength(1)
  })
})
