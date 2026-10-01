import { expect, it } from 'vitest'
import { buildChatSidebarRows } from './chat-sidebar-rows'
import { chatSidebarListItems } from './chat-sidebar-groups'
import { chatSession, chatState, chatTab, chatWorktree } from './chat-sidebar-test-fixtures'
import { withSleepingChatAgents } from './chat-sidebar-sleeping-agents'

it('keeps both idle pane conversations bracketed without live hooks and excludes removed leaves', () => {
  const first = '77777777-7777-4777-8777-777777777777'
  const second = '88888888-8888-4888-8888-888888888888'
  const tab = chatTab('split', { aiVaultTitle: null })
  const state = chatState({
    tabsByWorktree: { [chatWorktree.id]: [tab] },
    terminalLayoutsByTabId: {
      split: {
        root: {
          type: 'split',
          direction: 'horizontal',
          ratio: 0.5,
          first: { type: 'leaf', leafId: first },
          second: { type: 'leaf', leafId: second }
        },
        activeLeafId: first,
        expandedLeafId: null
      }
    },
    sleepingAgentSessionsByPaneKey: Object.fromEntries(
      [first, second].map((leaf, i) => [
        `split:${leaf}`,
        {
          paneKey: `split:${leaf}`,
          tabId: 'split',
          worktreeId: chatWorktree.id,
          agent: i ? ('claude' as const) : ('codex' as const),
          providerSession: { key: 'session_id' as const, id: leaf },
          prompt: 'Existing conversation',
          state: 'done' as const,
          capturedAt: 10000,
          updatedAt: 9000,
          origin: 'quit' as const
        }
      ])
    )
  })
  const sessions = [chatSession(first), chatSession(second, { agent: 'claude' })]
  const rows = buildChatSidebarRows(state, sessions, 20000)
  expect(rows).toHaveLength(2)
  expect(rows.map((r) => r.timestamp)).toEqual([2000, 2000])
  expect(rows.every((r) => r.tabId === 'split' && r.state === 'idle')).toBe(true)
  const items = chatSidebarListItems(rows, state, '').filter((item) => item.kind === 'chat')
  expect(items.every((item) => item.splitId && !item.subTab && item.showFolder)).toBe(true)
  const saved = withSleepingChatAgents([], state, chatWorktree.id)
  for (const status of ['working', 'waiting'] as const) {
    const current = { ...saved[0], state: status, rowSource: 'live' as const }
    const restored = withSleepingChatAgents([current], state, chatWorktree.id)
    expect(restored.find((row) => row.paneKey === current.paneKey)?.state).toBe(status)
  }
  const sibling = { ...saved[1], state: 'working' as const, rowSource: 'live' as const }
  const withoutSiblingRecord = {
    ...state,
    sleepingAgentSessionsByPaneKey: {
      [saved[0].paneKey]: state.sleepingAgentSessionsByPaneKey[saved[0].paneKey]
    }
  }
  const mixed = withSleepingChatAgents([sibling], withoutSiblingRecord, chatWorktree.id)
  expect(mixed).toHaveLength(2)
  expect(mixed.find((row) => row.paneKey === sibling.paneKey)).toBe(sibling)
  state.terminalLayoutsByTabId.split!.root = { type: 'leaf', leafId: first }
  expect(buildChatSidebarRows(state, sessions, 20000)).toHaveLength(1)
  state.tabsByWorktree = {}
  expect(buildChatSidebarRows(state, sessions, 20000)).toHaveLength(0)
})
