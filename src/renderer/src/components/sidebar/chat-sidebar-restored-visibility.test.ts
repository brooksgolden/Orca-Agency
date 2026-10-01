import { describe, expect, it } from 'vitest'
import { buildChatSidebarRows } from './chat-sidebar-rows'
import { chatSidebarPreferencePatch } from './chat-sidebar-identity'
import { closedChatSidebarPatch } from '@/lib/chat-sidebar-tab-close'
import { chatSessionKey } from './chat-sidebar-types'
import { chatSession, chatState, chatTab, chatWorktree } from './chat-sidebar-test-fixtures'

describe.each(['claude', 'codex'] as const)('%s restored conversation visibility', (agent) => {
  const key = chatSessionKey('local', agent, 'restored')
  const session = chatSession('restored', {
    agent,
    filePath:
      agent === 'claude'
        ? '/home/.claude/projects/-clients-Acme/restored.jsonl'
        : '/home/.codex/sessions/2026/09/30/rollout.jsonl'
  })
  const paneKey = 'reopened:77777777-7777-4777-8777-777777777777'
  function setup() {
    const state = chatState({
      tabsByWorktree: {
        [chatWorktree.id]: [chatTab('reopened', { launchAgent: agent, aiVaultTitle: null })]
      },
      agentStatusByPaneKey: {
        [paneKey]: {
          paneKey,
          agentType: agent,
          state: 'done',
          stateStartedAt: 9_000,
          updatedAt: 9_000,
          prompt: '',
          stateHistory: [],
          sessionBoundary: true,
          providerSession: { key: 'session_id', id: 'restored', transcriptPath: session.filePath }
        }
      }
    })
    state.settings!.chatSidebar = { hidden: [key, 'keep-hidden'], historySince: 0 }
    return state
  }

  it('shows resumed content before another prompt and keeps its original activity time', () => {
    const state = setup()
    const rows = buildChatSidebarRows(state, [session], 10_000)
    expect(rows).toMatchObject([{ sessionKey: key, tabId: 'reopened', timestamp: 2_000 }])
    const patch = chatSidebarPreferencePatch(rows, state.settings!.chatSidebar!, 10_000)!
    expect(patch.hidden).toEqual(['keep-hidden'])
    state.settings!.chatSidebar = { ...state.settings!.chatSidebar, ...patch }
    expect(
      chatSidebarPreferencePatch(
        buildChatSidebarRows(state, [session], 10_000),
        state.settings!.chatSidebar,
        10_000
      )
    ).toBeNull()
  })

  it('shows a short submitted turn before scanning and keeps it visible as Done after closing', () => {
    const state = setup()
    const entry = state.agentStatusByPaneKey[paneKey]
    entry.sessionBoundary = undefined
    entry.prompt = 'test'
    const rows = buildChatSidebarRows(state, [], 10_000)
    expect(rows).toHaveLength(1)
    const patch = closedChatSidebarPatch(rows, [], state.settings!.chatSidebar!, 10_000)
    state.settings!.chatSidebar = { ...state.settings!.chatSidebar, ...patch }
    state.tabsByWorktree = {}
    state.agentStatusByPaneKey = {}
    expect(buildChatSidebarRows(state, [], 11_000)).toMatchObject([
      { tabId: null, completed: true }
    ])
    expect(state.settings!.chatSidebar.hidden).toEqual(['keep-hidden'])
  })

  it('keeps unopened hidden history and automation sessions hidden', () => {
    const state = setup()
    state.tabsByWorktree = {}
    expect(buildChatSidebarRows(state, [session], 10_000)).toEqual([])
    const automated = setup()
    automated.settings!.chatSidebar!.automationChats = [key]
    expect(buildChatSidebarRows(automated, [session], 10_000)).toEqual([])
    const patch = chatSidebarPreferencePatch(
      buildChatSidebarRows(automated, [session], 10_000, undefined, true),
      automated.settings!.chatSidebar!,
      10_000
    )
    expect(patch?.hidden).toBeUndefined()
  })

  it('does not reveal an empty launch just because a tab is open', () => {
    const state = setup()
    const rows = buildChatSidebarRows(state, [], 10_000)
    expect(rows).toEqual([])
    expect(chatSidebarPreferencePatch(rows, state.settings!.chatSidebar!, 10_000)).toBeNull()
  })
})
