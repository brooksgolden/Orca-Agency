import { describe, expect, it } from 'vitest'
import { createGlobalSettingsFixture } from '../../../../shared/global-settings-test-fixture'
import { buildChatSidebarRows } from './chat-sidebar-rows'
import { chatSidebarPreferencePatch } from './chat-sidebar-identity'
import { chatFallbackId, chatSessionKey } from './chat-sidebar-types'
import { chatSession, chatState, chatTab, chatWorktree } from './chat-sidebar-test-fixtures'
import { chatWorkspaceFolderKey } from './chat-sidebar-workspace-folder'
import { closedChatSidebarPatch } from '@/lib/chat-sidebar-tab-close'
import { chatResumeSession } from './chat-sidebar-resume'

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

  it('shares the chosen folder with every resident chat, preserving both terminal owners', () => {
    const state = stateFor()
    const rows = buildChatSidebarRows(state, [], 10_000)
    expect(rows.find((row) => row.id === id)).toMatchObject({
      folder: 'Other',
      worktree: chatWorktree,
      folderWorktree: destination,
      tabId: 'a'
    })
    expect(rows.find((row) => row.tabId === 'b')).toMatchObject({
      folder: 'Other',
      worktree: chatWorktree
    })
    expect(state.tabsByWorktree[chatWorktree.id][0].ptyId).toBe('original-pty')
    expect(
      chatSidebarPreferencePatch(rows, state.settings!.chatSidebar!, 10_000)?.sessions?.[id]
        ?.worktreeId
    ).toBe(chatWorktree.id)
  })

  it('keeps the shared folder for new tabs after the original chat closes', () => {
    const state = stateFor()
    const rows = buildChatSidebarRows(state, [], 10_000)
    state.settings!.chatSidebar = {
      ...state.settings!.chatSidebar,
      ...chatSidebarPreferencePatch(rows, state.settings!.chatSidebar!, 10_000)
    }
    state.tabsByWorktree[chatWorktree.id] = [chatTab('new')]
    expect(buildChatSidebarRows(state, [], 10_000)[0].folder).toBe('Other')
  })

  it('does not assign a folder on another execution host', () => {
    const row = buildChatSidebarRows(stateFor('ssh:box'), [], 10_000).find((item) => item.id === id)
    expect(row?.folder).toBe('Acme')
    expect(row?.folderWorktree).toBeUndefined()
  })

  it('repairs older closed chats from their workspace folder without reopening them', () => {
    const state = stateFor()
    const assignment = { worktreeId: destination.id, executionHostId: 'local' as const }
    state.settings!.chatSidebar = {
      sessions: { [id]: { worktreeId: chatWorktree.id } },
      workspaceFolderAssignments: {
        [chatWorkspaceFolderKey({ hostId: 'local', worktree: chatWorktree })]: assignment
      },
      completed: { [id]: { at: 5_000, activityAt: 2_000, done: true } }
    }
    state.tabsByWorktree = {}
    const rows = buildChatSidebarRows(state, [chatSession('session-a')], 10_000)
    expect(rows[0]).toMatchObject({ tabId: null, folder: 'Other', completed: true })
    expect(chatResumeSession(rows[0])?.cwd).toBe(destination.path)
    const patch = chatSidebarPreferencePatch(rows, state.settings!.chatSidebar!, 10_000)
    expect(patch?.folderAssignments?.[id]).toEqual(assignment)
    state.settings!.chatSidebar = { ...state.settings!.chatSidebar, ...patch }
    state.settings!.chatSidebar.workspaceFolderAssignments = {}
    expect(buildChatSidebarRows(state, [chatSession('session-a')], 10_000)[0].folder).toBe('Other')
  })

  it('keeps a new helper in the workspace folder through close and resume', () => {
    const state = stateFor()
    const rows = buildChatSidebarRows(state, [], 10_000)
    state.settings!.chatSidebar = {
      ...state.settings!.chatSidebar,
      ...chatSidebarPreferencePatch(rows, state.settings!.chatSidebar!, 10_000)
    }
    const helperId = chatSessionKey('local', 'claude', 'helper')
    state.tabsByWorktree[chatWorktree.id].push(
      chatTab('helper', {
        launchAgent: 'claude',
        aiVaultTitle: { agent: 'claude', sessionId: 'helper', title: 'Review code' }
      })
    )
    const helper = chatSession('helper', { agent: 'claude' })
    const closing = buildChatSidebarRows(state, [helper], 11_000).filter(
      (row) => row.id === helperId
    )
    expect(closing[0]).toMatchObject({ tabId: 'helper', folder: 'Other' })
    state.tabsByWorktree[chatWorktree.id].pop()
    state.settings!.chatSidebar = {
      ...state.settings!.chatSidebar,
      ...closedChatSidebarPatch(closing, rows, state.settings!.chatSidebar!, 12_000)
    }
    const saved = buildChatSidebarRows(state, [helper], 13_000).find((row) => row.id === helperId)!
    expect(saved).toMatchObject({ tabId: null, folder: 'Other', completed: true })
    expect(chatResumeSession(saved)?.resumeCwd).toBe(destination.path)
  })

  it('respects an independently refiled closed chat and rejects invalid inherited folders', () => {
    const state = stateFor()
    state.tabsByWorktree = {}
    state.settings!.chatSidebar!.sessions = { [id]: { worktreeId: chatWorktree.id } }
    const key = chatWorkspaceFolderKey({ hostId: 'local', worktree: chatWorktree })
    state.settings!.chatSidebar!.workspaceFolderAssignments = {
      [key]: { worktreeId: chatWorktree.id, executionHostId: 'local' }
    }
    expect(buildChatSidebarRows(state, [chatSession('session-a')], 10_000)[0].folder).toBe('Other')
    state.settings!.chatSidebar!.folderAssignments = {}
    state.settings!.chatSidebar!.workspaceFolderAssignments[key] = {
      worktreeId: destination.id,
      executionHostId: 'ssh:box'
    }
    expect(buildChatSidebarRows(state, [chatSession('session-a')], 10_000)[0].folder).toBe('Acme')
    state.settings!.chatSidebar!.workspaceFolderAssignments[key].executionHostId = 'local'
    state.worktreesByRepo.other[0].isArchived = true
    expect(buildChatSidebarRows(state, [chatSession('session-a')], 10_000)[0].folder).toBe('Acme')
  })

  it('keeps the assignment when a temporary tab identity becomes a provider session', () => {
    const state = stateFor()
    const assignment = state.settings!.chatSidebar!.folderAssignments![id]
    const alias = chatFallbackId('local', 'a')
    state.settings!.chatSidebar!.folderAssignments = { [alias]: assignment }
    const rows = buildChatSidebarRows(state, [], 10_000)
    expect(rows.find((row) => row.id === id)?.folder).toBe('Other')
    const patch = chatSidebarPreferencePatch(rows, state.settings!.chatSidebar!, 10_000)
    expect(patch?.folderAssignments?.[id]).toEqual(assignment)
    expect(patch?.folderAssignments?.[chatSessionKey('local', 'codex', 'session-b')]).toEqual(
      assignment
    )
    expect(patch?.folderAssignments?.[alias]).toBeUndefined()
  })
})
