import { describe, expect, it } from 'vitest'
import { makePaneKey } from '../../../../shared/stable-pane-id'
import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import { placeWorkspaceAtEdge } from '@/lib/workspace-split-layout'
import { buildChatSidebarRows } from './chat-sidebar-rows'
import { chatSidebarListItems } from './chat-sidebar-groups'
import { chatSessionKey } from './chat-sidebar-types'
import {
  chatSession,
  chatState,
  chatTab,
  chatWorktree,
  chatRow
} from './chat-sidebar-test-fixtures'
import { chatLiveSessionSnapshot } from './chat-sidebar-session-snapshot'
import { chatSidebarPreferencePatch } from './chat-sidebar-identity'
import { closedChatSidebarPatch } from '@/lib/chat-sidebar-tab-close'

const leafId = '77777777-7777-4777-8777-777777777777'

function statusEntry(key: string, overrides: Partial<AgentStatusEntry> = {}): AgentStatusEntry {
  return {
    paneKey: key,
    state: 'done',
    stateStartedAt: 3_000,
    updatedAt: 3_000,
    stateHistory: [],
    prompt: '',
    agentType: 'claude',
    ...overrides
  }
}

describe('Claude background resume in Chats', () => {
  it('binds a live Claude /resume launcher only to its exact background transcript', () => {
    const launcherId = '8b1a93a0-1576-43df-88ba-5b3e742e8496'
    const targetId = '170dd324-3d4f-40d8-8e8b-ba261c0ee064'
    const projectDir = 'C:\\Users\\Ada\\.claude\\projects\\-clients-Acme'
    const launcher = chatSession(launcherId, {
      agent: 'claude',
      filePath: `${projectDir}\\${launcherId}.jsonl`,
      messageCount: 0,
      previewMessages: [],
      resumedSessionIdPrefix: '170dd324'
    })
    const target = chatSession(targetId, {
      agent: 'claude',
      title: 'Provider conversation name',
      filePath: `${projectDir}\\${targetId}.jsonl`,
      updatedAt: new Date(9_000).toISOString(),
      messageCount: 20
    })
    const livePane = makePaneKey('left', leafId)
    const state = chatState({
      tabsByWorktree: {
        [chatWorktree.id]: [
          chatTab('left', {
            launchAgent: 'claude',
            aiVaultTitle: null,
            customTitle: 'Manual session name'
          })
        ]
      },
      agentStatusByPaneKey: {
        [livePane]: statusEntry(livePane, {
          agentType: 'claude',
          prompt: '',
          sessionBoundary: true,
          providerSession: {
            key: 'session_id',
            id: launcherId,
            transcriptPath: launcher.filePath
          }
        })
      }
    })
    const rows = buildChatSidebarRows(state, [launcher, target], 10_000)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      tabId: 'left',
      paneKey: livePane,
      sessionKey: chatSessionKey('local', 'claude', targetId),
      manualTitle: 'Manual session name',
      timestamp: 9_000
    })
    expect(rows[0].session?.sessionId).toBe(targetId)
    expect(rows[0].liveSession).toMatchObject({
      sessionId: targetId,
      transcriptPath: target.filePath
    })
    expect(chatLiveSessionSnapshot(rows[0], 10_000)?.sessionId).toBe(targetId)
    const preference = chatSidebarPreferencePatch(rows, {}, 10_000)!
    expect(
      preference.sessions?.[chatSessionKey('local', 'claude', targetId)]?.resumeLauncher
    ).toMatchObject({
      sessionId: launcherId,
      targetSessionIdPrefix: '170dd324',
      tabId: 'left',
      paneKey: livePane
    })
    const savedState = chatState({
      ...state,
      settings: { ...state.settings!, chatSidebar: preference }
    })
    const withoutScan = buildChatSidebarRows(savedState, [], 11_000)
    expect(withoutScan.find((row) => row.tabId === 'left')).toMatchObject({
      sessionKey: chatSessionKey('local', 'claude', targetId),
      timestamp: 9_000
    })
    expect(
      buildChatSidebarRows(
        savedState,
        [{ ...launcher, resumedSessionIdPrefix: undefined }, target],
        11_000
      ).some((row) => row.tabId === 'left')
    ).toBe(false)
    const removedPrefix = { ...launcher, resumedSessionIdPrefix: undefined }
    expect(
      chatSidebarPreferencePatch([], preference, 11_000, {
        scannedSessions: [{ ...removedPrefix, executionHostId: 'ssh:other' }]
      })
    ).toBeNull()
    const revoked = chatSidebarPreferencePatch([], preference, 11_000, {
      scannedSessions: [removedPrefix]
    })!
    expect(
      revoked.sessions?.[chatSessionKey('local', 'claude', targetId)]?.resumeLauncher
    ).toBeUndefined()
    const revokedState = chatState({
      ...savedState,
      settings: {
        ...savedState.settings!,
        chatSidebar: { ...preference, ...revoked }
      }
    })
    expect(buildChatSidebarRows(revokedState, [], 12_000).some((row) => row.tabId === 'left')).toBe(
      false
    )
    expect(
      buildChatSidebarRows(
        savedState,
        [{ ...launcher, resumedSessionIdPrefix: 'aaaaaaaa' }, target],
        11_000
      ).some((row) => row.tabId === 'left')
    ).toBe(false)
    const closed = closedChatSidebarPatch(
      withoutScan.filter((row) => row.tabId === 'left'),
      [],
      savedState.settings!.chatSidebar!,
      12_000
    )
    expect(closed.completed?.[chatSessionKey('local', 'claude', targetId)]).toMatchObject({
      done: true,
      activityAt: 9_000
    })
    expect(
      (closed.sessions ?? savedState.settings!.chatSidebar!.sessions)?.[
        chatSessionKey('local', 'claude', targetId)
      ]?.snapshot?.sessionId
    ).toBe(targetId)
    const doneState = chatState({
      ...savedState,
      settings: {
        ...savedState.settings!,
        chatSidebar: { ...preference, completed: closed.completed }
      }
    })
    const idleDone = buildChatSidebarRows(doneState, [launcher, target], 12_500).find(
      (row) => row.tabId === 'left'
    )!
    expect(idleDone).toMatchObject({ completed: true, turnStartedAt: 0, timestamp: 9_000 })
    const oldPrompt = buildChatSidebarRows(
      doneState,
      [launcher, { ...target, lastHumanTurnAt: new Date(8_000).toISOString() }],
      12_500
    ).find((row) => row.tabId === 'left')!
    expect(oldPrompt.completed).toBe(true)
    const newPrompt = buildChatSidebarRows(
      doneState,
      [launcher, { ...target, lastHumanTurnAt: new Date(13_000).toISOString() }],
      13_000
    ).find((row) => row.tabId === 'left')!
    expect(newPrompt).toMatchObject({ completed: false, turnStartedAt: 13_000 })
    const reopenedPatch = chatSidebarPreferencePatch(
      [newPrompt],
      doneState.settings!.chatSidebar!,
      13_000
    )!
    expect(
      reopenedPatch.sessions?.[chatSessionKey('local', 'claude', targetId)]?.snapshot
        ?.lastHumanTurnAt
    ).toBe(new Date(13_000).toISOString())
    const restarted = chatState({
      ...doneState,
      settings: {
        ...doneState.settings!,
        chatSidebar: { ...doneState.settings!.chatSidebar!, ...reopenedPatch }
      }
    })
    expect(
      buildChatSidebarRows(restarted, [], 14_000).find((row) => row.tabId === 'left')
    ).toMatchObject({
      completed: false,
      turnStartedAt: 13_000
    })

    const launcherWithConversation = {
      ...launcher,
      messageCount: 2,
      resumedSessionIdPrefix: undefined
    }
    const rebornRows = buildChatSidebarRows(savedState, [launcherWithConversation, target], 13_000)
    const reborn = rebornRows.find((row) => row.tabId === 'left')!
    expect(reborn.sessionKey).toBe(chatSessionKey('local', 'claude', launcherId))
    const changed = chatSidebarPreferencePatch(rebornRows, preference, 13_000)!
    expect(
      changed.sessions?.[chatSessionKey('local', 'claude', targetId)]?.resumeLauncher
    ).toBeUndefined()

    const middle = chatRow({
      id: 'middle',
      tabId: 'middle',
      title: 'claude-video installation',
      worktree: { ...chatWorktree, id: 'middle' },
      timestamp: 8_000
    })
    const right = chatRow({
      id: 'right',
      tabId: 'right',
      title: 'Enable side-by-side workspaces',
      worktree: { ...chatWorktree, id: 'right' },
      timestamp: 7_000
    })
    const two = placeWorkspaceAtEdge([], middle.worktree.id, chatWorktree.id, 'right', 'joined')
    const three = placeWorkspaceAtEdge(
      two,
      right.worktree.id,
      middle.worktree.id,
      'right',
      'joined'
    )
    const items = chatSidebarListItems(
      [rows[0], middle, right, { ...middle, id: 'old-middle', tabId: null }],
      state,
      '',
      three
    ).filter((item) => item.kind === 'chat')
    expect(items.filter((item) => item.splitId).map((item) => item.id)).toEqual([
      chatSessionKey('local', 'claude', targetId),
      'middle',
      'right'
    ])
    expect(items.find((item) => item.id === 'old-middle')?.splitId).toBeUndefined()
    expect(items.filter((item) => item.splitId && item.showFolder)).toHaveLength(3)

    const unrelated = chatSession('77777777-7777-4777-8777-777777777777', {
      agent: 'claude',
      filePath: `${projectDir}\\unrelated.jsonl`,
      messageCount: 2
    })
    expect(buildChatSidebarRows(state, [launcher, unrelated], 10_000)).toEqual([])
    expect(
      buildChatSidebarRows(state, [launcher, { ...target, executionHostId: 'ssh:other' }], 10_000)
    ).toEqual([])
    expect(
      buildChatSidebarRows(
        state,
        [launcher, { ...target, filePath: 'C:\\other\\170dd324.jsonl' }],
        10_000
      )
    ).toEqual([])
    expect(buildChatSidebarRows(state, [launcher, { ...target, messageCount: 0 }], 10_000)).toEqual(
      []
    )
    const collision = chatSession('170dd324-0000-4000-8000-000000000000', {
      agent: 'claude',
      filePath: `${projectDir}\\collision.jsonl`,
      messageCount: 2
    })
    expect(buildChatSidebarRows(state, [launcher, target, collision], 10_000)).toEqual([])

    state.agentStatusByPaneKey = {
      [livePane]: statusEntry(livePane, {
        sessionBoundary: true,
        providerSession: {
          key: 'session_id',
          id: launcherId,
          transcriptPath: 'C:\\other\\8b1a93a0-1576-43df-88ba-5b3e742e8496.jsonl'
        }
      })
    }
    expect(buildChatSidebarRows(state, [launcher, target], 10_000)).toEqual([])
  })
})
