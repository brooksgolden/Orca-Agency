import { describe, expect, it } from 'vitest'
import { createGlobalSettingsFixture } from '../../../../shared/global-settings-test-fixture'
import { buildChatSidebarRows } from './chat-sidebar-rows'
import { chatSidebarPreferencePatch } from './chat-sidebar-identity'
import { chatFallbackId, chatSessionKey } from './chat-sidebar-types'
import { chatState, chatTab, chatWorktree } from './chat-sidebar-test-fixtures'

describe('per-chat folder assignment', () => {
  const destination = {
    ...chatWorktree,
    id: 'other::/clients/Other',
    repoId: 'other',
    path: '/clients/Other',
    hostId: 'local' as const
  }
  const id = chatSessionKey('local', 'codex', 'session-a')
  function stateFor(hostId: 'local' | 'ssh:box' = 'local') {
    const state = chatState({
      settings: createGlobalSettingsFixture({
        chatSidebar: {
          folderAssignments: { [id]: { worktreeId: destination.id, executionHostId: hostId } }
        }
      }),
      worktreesByRepo: { repo: [chatWorktree], other: [{ ...destination, hostId }] },
      tabsByWorktree: { [chatWorktree.id]: [chatTab('a', { ptyId: 'original-pty' }), chatTab('b')] }
    })
    state.repos = [
      ...state.repos,
      {
        ...state.repos[0],
        id: 'other',
        displayName: 'Other',
        path: destination.path,
        executionHostId: hostId
      }
    ]
    return state
  }

  it('changes only the chosen chat label and next destination, preserving both terminal owners', () => {
    const state = stateFor()
    const rows = buildChatSidebarRows(state, [], 10_000)
    expect(rows.find((row) => row.id === id)).toMatchObject({
      folder: 'Other',
      worktree: chatWorktree,
      folderWorktree: destination,
      tabId: 'a'
    })
    expect(rows.find((row) => row.tabId === 'b')).toMatchObject({
      folder: 'Acme',
      worktree: chatWorktree
    })
    expect(state.tabsByWorktree[chatWorktree.id][0].ptyId).toBe('original-pty')
    expect(
      chatSidebarPreferencePatch(rows, state.settings!.chatSidebar!, 10_000)?.sessions?.[id]
        ?.worktreeId
    ).toBe(chatWorktree.id)
  })

  it('does not assign a folder on another execution host', () => {
    const row = buildChatSidebarRows(stateFor('ssh:box'), [], 10_000).find((item) => item.id === id)
    expect(row?.folder).toBe('Acme')
    expect(row?.folderWorktree).toBeUndefined()
  })

  it('keeps the assignment when a temporary tab identity becomes a provider session', () => {
    const state = stateFor()
    const assignment = state.settings!.chatSidebar!.folderAssignments![id]
    const alias = chatFallbackId('local', 'a')
    state.settings!.chatSidebar!.folderAssignments = { [alias]: assignment }
    const rows = buildChatSidebarRows(state, [], 10_000)
    expect(rows.find((row) => row.id === id)?.folder).toBe('Other')
    const patch = chatSidebarPreferencePatch(rows, state.settings!.chatSidebar!, 10_000)
    expect(patch?.folderAssignments).toEqual({ [id]: assignment })
  })
})
