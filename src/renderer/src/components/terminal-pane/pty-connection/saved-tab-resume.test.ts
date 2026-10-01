import { describe, expect, it } from 'vitest'
import { savedTabResume } from './saved-tab-resume'
import {
  chatState,
  chatTab,
  chatSession,
  chatWorktree
} from '../../sidebar/chat-sidebar-test-fixtures'
import { chatSessionSnapshot } from '../../sidebar/chat-sidebar-session-snapshot'

function restored() {
  const tab = chatTab('a', {
    launchAgent: undefined,
    title: 'Terminal',
    customTitle: 'Aside profile extensions'
  })
  const snapshot = chatSessionSnapshot(
    chatSession('session-a', { title: 'Import extensions', codexHome: null })
  )
  const state = { ...chatState(), projects: [] }
  state.tabsByWorktree = { [chatWorktree.id]: [tab] }
  state.settings!.chatSidebar = {
    sessions: {
      '["local","codex","session-a"]': { worktreeId: chatWorktree.id, snapshot }
    }
  }
  return { state, snapshot }
}

describe('persisted tab conversation recovery', () => {
  it('uses the exact saved provider identity despite a renamed title and no live status', () => {
    const { state, snapshot } = restored()
    expect(savedTabResume(state, chatWorktree.id, 'a', 'local')).toEqual(snapshot)
  })
  it('never borrows a local conversation on another execution host', () => {
    const { state } = restored()
    expect(savedTabResume(state, chatWorktree.id, 'a', 'ssh:other')).toBeNull()
  })
  it('does not replay one tab identity into two terminal leaves', () => {
    const { state } = restored()
    state.terminalLayoutsByTabId.a = {
      root: {
        type: 'split',
        direction: 'horizontal',
        first: { type: 'leaf', leafId: 'a' },
        second: { type: 'leaf', leafId: 'b' }
      },
      activeLeafId: 'a',
      expandedLeafId: null
    }
    expect(savedTabResume(state, chatWorktree.id, 'a', 'local')).toBeNull()
  })
  it('rejects an inconsistent saved identity instead of opening a different conversation', () => {
    const { state, snapshot } = restored()
    snapshot.sessionId = 'different-fork'
    expect(savedTabResume(state, chatWorktree.id, 'a', 'local')).toBeNull()
  })
  it('ignores empty tabs and retains a custom Codex home', () => {
    const { state, snapshot } = restored()
    snapshot.codexHome = 'C:/profiles/client codex'
    expect(savedTabResume(state, chatWorktree.id, 'a', 'local')?.codexHome).toBe(snapshot.codexHome)
    state.tabsByWorktree[chatWorktree.id][0].aiVaultTitle = null
    expect(savedTabResume(state, chatWorktree.id, 'a', 'local')).toBeNull()
  })
})
