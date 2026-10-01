import { describe, expect, it } from 'vitest'
import { savedTabResume } from './saved-tab-resume'
import {
  chatState,
  chatTab,
  chatSession,
  chatWorktree
} from '../../sidebar/chat-sidebar-test-fixtures'
import { chatSessionSnapshot } from '../../sidebar/chat-sidebar-session-snapshot'
import { makePaneKey } from '../../../../../shared/stable-pane-id'

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
  it('recovers an exact Claude background target from its saved launcher proof', () => {
    const { state } = restored()
    const launcherId = '8b1a93a0-1576-43df-88ba-5b3e742e8496'
    const targetId = '170dd324-3d4f-40d8-8e8b-ba261c0ee064'
    const dir = 'C:\\Users\\Ada\\.claude\\projects\\-clients-Acme'
    const launcherPath = `${dir}\\${launcherId}.jsonl`
    const targetPath = `${dir}\\${targetId}.jsonl`
    const paneKey = makePaneKey('a', '77777777-7777-4777-8777-777777777777')
    const tab = state.tabsByWorktree[chatWorktree.id][0]
    tab.launchAgent = 'claude'
    tab.aiVaultTitle = null
    const snapshot = chatSessionSnapshot(
      chatSession(targetId, { agent: 'claude', filePath: targetPath, cwd: chatWorktree.path })
    )
    const proof = {
      agent: 'claude' as const,
      sessionId: launcherId,
      transcriptPath: launcherPath,
      tabId: 'a',
      paneKey,
      targetSessionIdPrefix: '170dd324'
    }
    state.settings!.chatSidebar = {
      sessions: {
        [JSON.stringify(['local', 'claude', targetId])]: {
          worktreeId: chatWorktree.id,
          snapshot,
          resumeLauncher: proof
        }
      }
    }
    state.agentStatusByPaneKey = {
      [paneKey]: {
        paneKey,
        agentType: 'claude',
        state: 'done',
        stateStartedAt: 1,
        updatedAt: 1,
        stateHistory: [],
        prompt: '',
        providerSession: { key: 'session_id', id: launcherId, transcriptPath: launcherPath }
      }
    }
    expect(savedTabResume(state, chatWorktree.id, 'a', 'local', paneKey)).toMatchObject({
      sessionId: targetId,
      resumeLauncher: proof
    })
    state.terminalLayoutsByTabId.a = {
      root: {
        type: 'split',
        direction: 'horizontal',
        first: { type: 'leaf', leafId: '77777777-7777-4777-8777-777777777777' },
        second: { type: 'leaf', leafId: '88888888-8888-4888-8888-888888888888' }
      },
      activeLeafId: '77777777-7777-4777-8777-777777777777',
      expandedLeafId: null
    }
    expect(savedTabResume(state, chatWorktree.id, 'a', 'local', paneKey)?.sessionId).toBe(targetId)
    expect(
      savedTabResume(
        state,
        chatWorktree.id,
        'a',
        'local',
        makePaneKey('a', '88888888-8888-4888-8888-888888888888')
      )
    ).toBeNull()
    const siblingPaneKey = makePaneKey('a', '88888888-8888-4888-8888-888888888888')
    tab.aiVaultTitle = { agent: 'codex', sessionId: 'sibling-session', title: 'Sibling' }
    expect(savedTabResume(state, chatWorktree.id, 'a', 'local', paneKey)).toBeNull()
    state.agentStatusByPaneKey[siblingPaneKey] = {
      paneKey: siblingPaneKey,
      tabId: 'a',
      worktreeId: chatWorktree.id,
      agentType: 'codex',
      state: 'done',
      stateStartedAt: 1,
      updatedAt: 1,
      stateHistory: [],
      prompt: '',
      providerSession: { key: 'session_id', id: 'sibling-session' }
    }
    expect(savedTabResume(state, chatWorktree.id, 'a', 'local', paneKey)?.sessionId).toBe(targetId)
    state.terminalLayoutsByTabId.a.root = {
      type: 'split',
      direction: 'horizontal',
      first: { type: 'leaf', leafId: '99999999-9999-4999-8999-999999999999' },
      second: { type: 'leaf', leafId: '88888888-8888-4888-8888-888888888888' }
    }
    expect(savedTabResume(state, chatWorktree.id, 'a', 'local', paneKey)).toBeNull()
    state.terminalLayoutsByTabId.a.root = {
      type: 'split',
      direction: 'horizontal',
      first: { type: 'leaf', leafId: '77777777-7777-4777-8777-777777777777' },
      second: { type: 'leaf', leafId: '88888888-8888-4888-8888-888888888888' }
    }
    state.agentStatusByPaneKey[siblingPaneKey].providerSession = {
      key: 'session_id',
      id: 'another-session'
    }
    expect(savedTabResume(state, chatWorktree.id, 'a', 'local', paneKey)).toBeNull()
    state.agentStatusByPaneKey[siblingPaneKey].providerSession = {
      key: 'session_id',
      id: 'sibling-session'
    }
    state.agentStatusByPaneKey[paneKey].providerSession = {
      key: 'session_id',
      id: 'unrelated-current-pane'
    }
    expect(savedTabResume(state, chatWorktree.id, 'a', 'local', paneKey)).toBeNull()
    state.agentStatusByPaneKey[paneKey].providerSession = {
      key: 'session_id',
      id: launcherId,
      transcriptPath: launcherPath
    }
    delete state.agentStatusByPaneKey[siblingPaneKey]
    state.sleepingAgentSessionsByPaneKey[siblingPaneKey] = {
      paneKey: siblingPaneKey,
      tabId: 'a',
      worktreeId: chatWorktree.id,
      agent: 'codex',
      providerSession: { key: 'session_id', id: 'sibling-session' },
      prompt: '',
      state: 'done',
      capturedAt: 1,
      updatedAt: 1
    }
    expect(savedTabResume(state, chatWorktree.id, 'a', 'local', paneKey)?.sessionId).toBe(targetId)
    state.sleepingAgentSessionsByPaneKey[siblingPaneKey].worktreeId = 'other-worktree'
    expect(savedTabResume(state, chatWorktree.id, 'a', 'local', paneKey)).toBeNull()
    delete state.sleepingAgentSessionsByPaneKey[siblingPaneKey]
    tab.aiVaultTitle = null
    state.terminalLayoutsByTabId = {}
    expect(savedTabResume(state, chatWorktree.id, 'a', 'ssh:other', paneKey)).toBeNull()
    state.agentStatusByPaneKey[paneKey].prompt = 'A later prompt in the launcher'
    expect(savedTabResume(state, chatWorktree.id, 'a', 'local', paneKey)).toBeNull()
    state.agentStatusByPaneKey[paneKey].prompt = ''
    state.agentStatusByPaneKey[paneKey].providerSession = {
      key: 'session_id',
      id: launcherId,
      transcriptPath: 'C:\\other\\launcher.jsonl'
    }
    expect(savedTabResume(state, chatWorktree.id, 'a', 'local', paneKey)).toBeNull()
    state.agentStatusByPaneKey[paneKey].providerSession = {
      key: 'session_id',
      id: '99999999-9999-4999-8999-999999999999',
      transcriptPath: launcherPath
    }
    expect(savedTabResume(state, chatWorktree.id, 'a', 'local', paneKey)).toBeNull()
    state.agentStatusByPaneKey[paneKey].providerSession = {
      key: 'session_id',
      id: launcherId,
      transcriptPath: launcherPath
    }
    Reflect.set(proof, 'transcriptPath', 123)
    expect(savedTabResume(state, chatWorktree.id, 'a', 'local', paneKey)).toBeNull()
  })
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
