import { describe, expect, it } from 'vitest'
import { makePaneKey } from '../../../../shared/stable-pane-id'
import { chatSessionSnapshot } from './chat-sidebar-session-snapshot'
import { buildChatSidebarRows } from './chat-sidebar-rows'
import { chatSidebarListItems } from './chat-sidebar-groups'
import { chatSidebarPreferencePatch } from './chat-sidebar-identity'
import { chatSessionKey } from './chat-sidebar-types'
import {
  chatSession,
  chatState,
  chatTab,
  chatWorktree,
  chatRow
} from './chat-sidebar-test-fixtures'

const launcherId = '100ed808-bc83-4582-89c3-0f7a8b413c3f'
const targetId = '170dd324-3d4f-40d8-8e8b-ba261c0ee064'
const leafId = '77777777-7777-4777-8777-777777777777'
const paneKey = makePaneKey('claude-tab', leafId)
const key = chatSessionKey('local', 'claude', targetId)
const directory = 'C:/Users/Ada/.claude/projects/-clients-Acme'
const target = chatSession(targetId, {
  agent: 'claude',
  title: 'Resumed conversation',
  filePath: `${directory}/${targetId}.jsonl`,
  lastHumanTurnAt: new Date(2_000).toISOString()
})
const proof = {
  agent: 'claude' as const,
  sessionId: launcherId,
  transcriptPath: `${directory}/${launcherId}.jsonl`,
  tabId: 'claude-tab',
  paneKey,
  targetSessionIdPrefix: '170dd324'
}

function coldState() {
  const state = chatState({
    tabsByWorktree: {
      [chatWorktree.id]: [
        chatTab('claude-tab', {
          launchAgent: undefined,
          aiVaultTitle: { agent: 'claude', sessionId: launcherId, title: '' }
        })
      ]
    },
    terminalLayoutsByTabId: {
      'claude-tab': { root: { type: 'leaf', leafId }, activeLeafId: leafId, expandedLeafId: null }
    }
  })
  state.settings!.chatSidebar = {
    sessions: {
      [key]: {
        worktreeId: chatWorktree.id,
        snapshot: chatSessionSnapshot(target),
        resumeLauncher: proof
      }
    }
  }
  return state
}

describe('saved Claude resume before hook reconnection', () => {
  it('keeps its resident identity and bracket through a cold restore without changing activity', () => {
    const state = coldState()
    const rows = buildChatSidebarRows(state, [], 50_000)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: key,
      tabId: 'claude-tab',
      paneKey,
      timestamp: 2_000,
      state: 'idle'
    })
    const right = chatRow({
      id: 'right',
      tabId: 'right',
      worktree: { ...chatWorktree, id: 'right' }
    })
    const items = chatSidebarListItems([...rows, right], state, '', [
      {
        id: 'joined',
        layout: {
          type: 'split',
          direction: 'horizontal',
          first: { type: 'leaf', workspaceId: chatWorktree.id },
          second: { type: 'leaf', workspaceId: 'right' },
          ratio: 0.5
        }
      }
    ]).filter((item) => item.kind === 'chat')
    expect(items.map((item) => item.splitId)).toEqual(['joined', 'joined'])
    expect(items.every((item) => item.showFolder)).toBe(true)
    const patch = chatSidebarPreferencePatch(rows, state.settings!.chatSidebar!, 50_000)
    expect(patch?.sessions?.[key]?.snapshot?.updatedAt ?? target.updatedAt).toBe(target.updatedAt)
  })

  it('reconnects after live PTYs restore but hooks remain absent', () => {
    const state = coldState()
    state.ptyIdsByTabId = { 'claude-tab': ['pty'] }
    state.runtimePaneTitlesByTabId = { 'claude-tab': { 1: '✳ Resumed conversation' } }
    expect(buildChatSidebarRows(state, [], 50_000)[0]).toMatchObject({
      id: key,
      tabId: 'claude-tab'
    })
  })

  it('leaves a closed tab as separate history', () => {
    const state = coldState()
    state.tabsByWorktree = {}
    expect(buildChatSidebarRows(state, [], 50_000)[0]).toMatchObject({ id: key, tabId: null })
  })

  it('rejects a changed leaf or launcher identity', () => {
    const state = coldState()
    state.terminalLayoutsByTabId = {}
    expect(buildChatSidebarRows(state, [], 50_000)[0]?.tabId).toBeNull()
    const changed = coldState()
    changed.tabsByWorktree[chatWorktree.id][0].aiVaultTitle!.sessionId = 'another-launcher'
    expect(buildChatSidebarRows(changed, [], 50_000)[0]?.tabId).toBeNull()
  })

  it('rejects another host and a scan that revokes the resume prefix', () => {
    const state = coldState()
    state.settings!.chatSidebar!.sessions![key].snapshot!.executionHostId = 'ssh:other'
    expect(buildChatSidebarRows(state, [], 50_000)).toEqual([])
    const launcher = chatSession(launcherId, {
      agent: 'claude',
      filePath: proof.transcriptPath,
      messageCount: 0
    })
    expect(buildChatSidebarRows(coldState(), [launcher], 50_000)[0]?.tabId).toBeNull()
  })

  it('does not override conflicting hook identity or transcript evidence', () => {
    for (const providerSession of [
      { key: 'session_id' as const, id: 'another-launcher', transcriptPath: proof.transcriptPath },
      { key: 'session_id' as const, id: launcherId, transcriptPath: 'C:/other/launcher.jsonl' }
    ]) {
      const state = coldState()
      state.agentStatusByPaneKey = {
        [paneKey]: {
          paneKey,
          agentType: 'claude',
          state: 'done',
          stateStartedAt: 3_000,
          updatedAt: 3_000,
          stateHistory: [],
          prompt: '',
          sessionBoundary: true,
          providerSession
        }
      }
      expect(
        buildChatSidebarRows(state, [], 50_000).find((row) => row.id === key)?.tabId
      ).toBeNull()
    }
  })

  it('honors saved sleeping session identity before a new conversation starts', () => {
    for (const providerSession of [
      { key: 'session_id' as const, id: 'cleared-session', transcriptPath: proof.transcriptPath },
      { key: 'session_id' as const, id: launcherId, transcriptPath: 'C:/other/launcher.jsonl' }
    ]) {
      const state = coldState()
      state.sleepingAgentSessionsByPaneKey = {
        [paneKey]: {
          paneKey,
          tabId: 'claude-tab',
          worktreeId: chatWorktree.id,
          agent: 'claude',
          providerSession,
          prompt: '',
          state: 'done',
          capturedAt: 3_000,
          updatedAt: 3_000
        }
      }
      expect(
        buildChatSidebarRows(state, [], 50_000).find((row) => row.id === key)?.tabId
      ).toBeNull()
    }
  })

  it('honors retained provider identity after an empty launcher exits', () => {
    for (const providerSession of [
      { key: 'session_id' as const, id: 'cleared-session', transcriptPath: proof.transcriptPath },
      { key: 'session_id' as const, id: launcherId, transcriptPath: 'C:/other/launcher.jsonl' }
    ]) {
      const state = coldState()
      state.retainedAgentsByPaneKey = {
        [paneKey]: {
          worktreeId: chatWorktree.id,
          tab: state.tabsByWorktree[chatWorktree.id][0],
          agentType: 'claude',
          startedAt: 3_000,
          entry: {
            paneKey,
            agentType: 'claude',
            state: 'done',
            stateStartedAt: 3_000,
            updatedAt: 3_000,
            stateHistory: [],
            prompt: '',
            sessionBoundary: true,
            providerSession
          }
        }
      }
      expect(
        buildChatSidebarRows(state, [], 50_000).find((row) => row.id === key)?.tabId
      ).toBeNull()
    }
  })
})
