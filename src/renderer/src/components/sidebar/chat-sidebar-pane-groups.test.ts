import { describe, expect, it } from 'vitest'
import { chatSidebarListItems } from './chat-sidebar-groups'
import { buildChatSidebarRows } from './chat-sidebar-rows'
import { chatRow, chatState, chatTab, chatWorktree } from './chat-sidebar-test-fixtures'
import type { Tab, TabGroupLayoutNode } from '../../../../shared/tab-types'
import { makePaneKey } from '../../../../shared/stable-pane-id'
import { chatSessionKey } from './chat-sidebar-types'
import { placeWorkspaceAtEdge } from '@/lib/workspace-split-layout'

const worktreeId = chatWorktree.id
const tabs = ['a', 'b', 'c'].map((id, index): Tab => ({
  id: `unified-${id}`,
  entityId: id,
  groupId: 'left',
  worktreeId,
  contentType: 'terminal',
  label: id,
  customLabel: null,
  color: null,
  createdAt: 1_000 + index,
  sortOrder: index
}))
const rows = ['a', 'b', 'c'].map((id) => chatRow({ id, tabId: id }))
const layout: TabGroupLayoutNode = {
  type: 'split',
  direction: 'horizontal',
  first: { type: 'leaf', groupId: 'left' },
  second: { type: 'leaf', groupId: 'right' }
}
function state() {
  const layoutByWorktree: Record<string, TabGroupLayoutNode> = {
    [worktreeId]: { type: 'leaf', groupId: 'left' }
  }
  return {
    ...chatState({ tabsByWorktree: { [worktreeId]: rows.map((r) => chatTab(r.id)) } }),
    unifiedTabsByWorktree: { [worktreeId]: tabs },
    groupsByWorktree: {
      [worktreeId]: [
        { id: 'left', worktreeId, activeTabId: 'unified-a', tabOrder: tabs.map((t) => t.id) }
      ]
    },
    layoutByWorktree
  }
}
const chats = (source: ReturnType<typeof state>, values = rows) =>
  chatSidebarListItems(values, source, '').filter((item) => item.kind === 'chat')

describe('chat connectors follow pane layout', () => {
  it('keeps distinct Claude and Codex titles and nests the second chat in one pane', () => {
    const source = state()
    source.worktreesByRepo = {
      repo: [{ ...chatWorktree, displayName: 'Agency launch plan' }]
    }
    const claudeTab = chatTab('claude', {
      launchAgent: 'claude',
      aiVaultTitle: {
        agent: 'claude',
        sessionId: 'claude-session',
        title: 'Femi Slack strategy for partners'
      }
    })
    const claudeUnified: Tab = {
      id: 'claude-unified',
      entityId: claudeTab.id,
      groupId: 'left',
      worktreeId,
      contentType: 'terminal',
      label: 'Femi Slack strategy for partners',
      customLabel: null,
      color: null,
      createdAt: 1_000,
      sortOrder: 0
    }
    const codexUnified: Tab = {
      id: 'codex-unified',
      entityId: 'codex-session',
      groupId: 'left',
      worktreeId,
      contentType: 'agent-session',
      agentSessionAgent: 'codex',
      aiVaultTitle: {
        agent: 'codex',
        sessionId: 'codex-session',
        title: 'Audit Manatal posting candidates'
      },
      label: 'Audit Manatal posting candidates',
      customLabel: null,
      color: null,
      createdAt: 2_000,
      sortOrder: 1
    }
    source.tabsByWorktree = { [worktreeId]: [claudeTab] }
    const claudeSessionKey = chatSessionKey('local', 'claude', 'claude-session')
    source.settings!.chatSidebar = {
      titles: {},
      sessions: {
        [claudeSessionKey]: { worktreeId, ownsWorkspaceName: true }
      }
    }
    source.unifiedTabsByWorktree = { [worktreeId]: [claudeUnified, codexUnified] }
    source.groupsByWorktree = {
      [worktreeId]: [
        {
          id: 'left',
          worktreeId,
          activeTabId: claudeUnified.id,
          tabOrder: [claudeUnified.id, codexUnified.id]
        }
      ]
    }
    const built = buildChatSidebarRows(source, [], 10_000)
    const result = chatSidebarListItems(built, source, '').filter((item) => item.kind === 'chat')

    expect(result.map((item) => [item.row.agentType, item.row.title, item.subTab])).toEqual([
      ['claude', 'Femi Slack strategy for partners', false],
      ['codex', 'Audit Manatal posting candidates', true]
    ])

    source.settings!.chatSidebar!.titles = {
      [claudeSessionKey]: 'My Claude conversation name'
    }
    claudeTab.aiVaultTitle = {
      ...claudeTab.aiVaultTitle!,
      title: 'Femi partner strategy retitled by Claude'
    }
    codexUnified.aiVaultTitle = {
      agent: 'codex',
      sessionId: 'codex-session',
      title: 'Manatal audit retitled by Codex'
    }
    codexUnified.label = 'Manatal audit retitled by Codex'
    const restored = structuredClone(source)
    const restoredItems = chatSidebarListItems(
      buildChatSidebarRows(restored, [], 20_000),
      restored,
      ''
    ).filter((item) => item.kind === 'chat')
    expect(
      restoredItems.map((item) => [item.row.agentType, item.row.title, item.subTab])
    ).toEqual([
      ['claude', 'My Claude conversation name', false],
      ['codex', 'Manatal audit retitled by Codex', true]
    ])
  })

  it('changes the parent immediately when tabs are reordered, including after restoring layout', () => {
    const source = state()
    const owner = source.groupsByWorktree[worktreeId][0]
    const values = rows.map((row) => ({ ...row, ownsWorkspaceName: row.id === 'a' }))
    expect(chats(source, values).map((row) => [row.id, row.subTab])).toEqual([
      ['a', false],
      ['b', true],
      ['c', true]
    ])
    owner.tabOrder = ['unified-b', 'unified-a', 'unified-c']
    expect(chats(source, values).map((row) => [row.id, row.subTab])).toEqual([
      ['b', false],
      ['a', true],
      ['c', true]
    ])
    const restored = {
      ...source,
      groupsByWorktree: JSON.parse(JSON.stringify(source.groupsByWorktree))
    }
    expect(chats(restored, values).map((row) => [row.id, row.subTab])).toEqual([
      ['b', false],
      ['a', true],
      ['c', true]
    ])
  })

  it('switches from elbows to brackets on split and back when tabs rejoin', () => {
    const source = state()
    expect(chats(source).map((r) => [r.subTab, Boolean(r.splitId)])).toEqual([
      [false, false],
      [true, false],
      [true, false]
    ])
    const originalGroups = source.groupsByWorktree
    source.groupsByWorktree = {
      [worktreeId]: [
        { id: 'right', worktreeId, activeTabId: 'unified-b', tabOrder: ['unified-b'] },
        { id: 'left', worktreeId, activeTabId: 'unified-a', tabOrder: ['unified-a', 'unified-c'] }
      ]
    }
    source.layoutByWorktree = { [worktreeId]: layout }
    const split = chats(source)
    expect(split.map((r) => [r.id, r.subTab, r.showFolder])).toEqual([
      ['a', false, false],
      ['c', true, true],
      ['b', false, true]
    ])
    expect(new Set(split.map((r) => r.splitId)).size).toBe(1)
    expect(split[0].splitId).toBeTruthy()
    expect(split[0].splitStart).toBe(true)
    expect(split[2].splitEnd).toBe(true)
    source.groupsByWorktree = originalGroups
    source.layoutByWorktree = { [worktreeId]: { type: 'leaf', groupId: 'left' } }
    expect(chats(source).map((r) => [r.subTab, Boolean(r.splitId)])).toEqual([
      [false, false],
      [true, false],
      [true, false]
    ])
  })

  it('does not create brackets for a file-only pane or closed history', () => {
    const source = state()
    source.layoutByWorktree = { [worktreeId]: layout }
    expect(chats(source).some((r) => r.splitId)).toBe(false)
    const closed = { ...rows[1], tabId: null, completed: true }
    const result = chats(source, [rows[0], closed])
    expect(result.every((r) => !r.splitId && !r.subTab)).toBe(true)
  })

  it('brackets separate terminal leaves even within one tab', () => {
    const source = state(),
      first = '77777777-7777-4777-8777-777777777777',
      second = '88888888-8888-4888-8888-888888888888'
    source.terminalLayoutsByTabId = {
      a: {
        root: {
          type: 'split',
          direction: 'horizontal',
          first: { type: 'leaf', leafId: first },
          second: { type: 'leaf', leafId: second }
        },
        activeLeafId: first,
        expandedLeafId: null
      }
    }
    const result = chats(source, [
      { ...rows[0], paneKey: makePaneKey('a', first) },
      { ...rows[1], tabId: 'a', paneKey: makePaneKey('a', second) }
    ])
    expect(result.map((r) => r.subTab)).toEqual([false, false])
    expect(result.every((r) => r.splitId)).toBe(true)
  })

  it('ignores a plain shell leaf beside one chat in a tab', () => {
    const source = state()
    const leaf = '77777777-7777-4777-8777-777777777777'
    source.terminalLayoutsByTabId = {
      a: {
        root: {
          type: 'split',
          direction: 'horizontal',
          first: { type: 'leaf', leafId: leaf },
          second: { type: 'leaf', leafId: '88888888-8888-4888-8888-888888888888' }
        },
        activeLeafId: leaf,
        expandedLeafId: null
      }
    }
    expect(
      chats(source, [{ ...rows[0], paneKey: makePaneKey('a', leaf) }, rows[1]]).map((row) => [
        row.subTab,
        Boolean(row.splitId)
      ])
    ).toEqual([
      [false, false],
      [true, false]
    ])
  })

  it('combines workspace brackets with pane brackets and keeps one footer per pane', () => {
    const source = state()
    source.layoutByWorktree = { [worktreeId]: layout }
    source.groupsByWorktree[worktreeId].push({
      id: 'right',
      worktreeId,
      activeTabId: 'unified-b',
      tabOrder: ['unified-b']
    })
    source.groupsByWorktree[worktreeId][0].tabOrder = ['unified-a', 'unified-c']
    const other = chatRow({
      id: 'other',
      tabId: 'other',
      worktree: { ...chatWorktree, id: 'other' },
      folder: 'Elsewhere'
    })
    const result = chatSidebarListItems(
      [...rows, other],
      source,
      '',
      placeWorkspaceAtEdge([], 'other', worktreeId, 'bottom', 'joined')
    ).filter((r) => r.kind === 'chat')
    expect(result.map((r) => r.id)).toEqual(['a', 'c', 'b', 'other'])
    expect(result.map((r) => r.subTab)).toEqual([false, true, false, false])
    expect(result.every((r) => r.splitId === 'joined')).toBe(true)
    expect(result.filter((r) => r.showFolder).map((r) => r.id)).toEqual(['c', 'b', 'other'])
  })
})
