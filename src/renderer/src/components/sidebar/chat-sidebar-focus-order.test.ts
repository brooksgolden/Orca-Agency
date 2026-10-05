import { describe, expect, it } from 'vitest'
import { chatSidebarListItems } from './chat-sidebar-groups'
import { chatRow, chatState, chatWorktree } from './chat-sidebar-test-fixtures'
import { placeWorkspaceAtEdge } from '@/lib/workspace-split-layout'

describe('focused running chat groups', () => {
  const older = chatRow({ id: 'older', state: 'working', timestamp: 10 })
  const newer = chatRow({
    id: 'newer',
    worktree: { ...chatWorktree, id: 'newer' },
    state: 'working',
    timestamp: 20
  })
  const idle = chatRow({
    id: 'idle',
    worktree: { ...chatWorktree, id: 'idle' },
    timestamp: 30
  })
  const ordered = (worktreeId: string, rows = [older, newer, idle]) =>
    chatSidebarListItems(rows, chatState(), '', [], undefined, { worktreeId, hostId: 'local' })
      .filter((item) => item.kind === 'chat')
      .map((item) => item.id)

  it('switches priority between running groups without changing activity', () => {
    expect(ordered(older.worktree.id)).toEqual(['older', 'newer', 'idle'])
    expect(ordered(newer.worktree.id)).toEqual(['newer', 'older', 'idle'])
    expect([older.timestamp, newer.timestamp, idle.timestamp]).toEqual([10, 20, 30])
  })

  it('does not promote an idle chat or an unrelated host', () => {
    expect(ordered(idle.worktree.id)).toEqual(['newer', 'older', 'idle'])
    expect(ordered(older.worktree.id, [{ ...older, hostId: 'ssh:other' }, newer, idle])).toEqual([
      'newer',
      'older',
      'idle'
    ])
  })

  it('keeps a focused split together in visual order, even when its focused pane is idle', () => {
    const splits = placeWorkspaceAtEdge([], idle.worktree.id, older.worktree.id, 'right', 'split')
    const chats = chatSidebarListItems([older, newer, idle], chatState(), '', splits, undefined, {
      worktreeId: idle.worktree.id,
      hostId: 'local'
    }).filter((item) => item.kind === 'chat')
    expect(chats.map((item) => item.id)).toEqual(['older', 'idle', 'newer'])
    expect(chats.map((item) => item.splitId)).toEqual(['split', 'split', undefined])
  })
})
