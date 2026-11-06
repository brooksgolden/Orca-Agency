import { describe, expect, it } from 'vitest'
import type { AppState } from '../../../types'
import {
  findTerminalOriginGroupId,
  resolveTerminalOriginGroupId
} from './editor-open-target-group'

type TargetState = Pick<
  AppState,
  'activeGroupIdByWorktree' | 'groupsByWorktree' | 'unifiedTabsByWorktree'
>

function splitState(activeGroupId: string): TargetState {
  return {
    activeGroupIdByWorktree: { 'wt-1': activeGroupId },
    groupsByWorktree: {
      'wt-1': [
        { id: 'group-chat', activeTabId: 'chat-terminal' },
        { id: 'group-markdown', activeTabId: 'markdown-editor' }
      ]
    },
    unifiedTabsByWorktree: {
      'wt-1': [
        {
          id: 'chat-terminal',
          entityId: 'chat-terminal',
          groupId: 'group-chat',
          contentType: 'terminal'
        },
        {
          id: 'markdown-editor',
          entityId: 'markdown-file',
          groupId: 'group-markdown',
          contentType: 'editor'
        }
      ]
    }
  } as unknown as TargetState
}

describe('resolveTerminalOriginGroupId', () => {
  it('returns the group holding the terminal tab even when another group is active', () => {
    expect(
      resolveTerminalOriginGroupId(splitState('group-markdown'), 'wt-1', 'chat-terminal')
    ).toBe('group-chat')
  })

  it('returns the same group when the terminal group is already active', () => {
    expect(resolveTerminalOriginGroupId(splitState('group-chat'), 'wt-1', 'chat-terminal')).toBe(
      'group-chat'
    )
  })

  it('falls back to the active group when the terminal tab is unknown', () => {
    expect(resolveTerminalOriginGroupId(splitState('group-markdown'), 'wt-1', 'missing-tab')).toBe(
      'group-markdown'
    )
    expect(resolveTerminalOriginGroupId(splitState('group-markdown'), 'wt-1', null)).toBe(
      'group-markdown'
    )
  })

  it('falls back to the first group when no active group is recorded', () => {
    const state = { ...splitState('group-chat'), activeGroupIdByWorktree: {} } as TargetState
    expect(resolveTerminalOriginGroupId(state, 'wt-1', undefined)).toBe('group-chat')
  })

  it('matches a native chat agent-session tab by its tab id', () => {
    const state = {
      activeGroupIdByWorktree: { 'wt-1': 'group-markdown' },
      groupsByWorktree: {
        'wt-1': [
          { id: 'group-chat', activeTabId: 'session-tab' },
          { id: 'group-markdown', activeTabId: 'markdown-editor' }
        ]
      },
      unifiedTabsByWorktree: {
        'wt-1': [
          {
            id: 'session-tab',
            entityId: 'session-entity',
            groupId: 'group-chat',
            contentType: 'agent-session'
          },
          {
            id: 'markdown-editor',
            entityId: 'markdown-file',
            groupId: 'group-markdown',
            contentType: 'editor'
          }
        ]
      }
    } as unknown as TargetState
    expect(resolveTerminalOriginGroupId(state, 'wt-1', 'session-tab')).toBe('group-chat')
  })

  it('returns undefined for a worktree with no groups', () => {
    const empty = {
      activeGroupIdByWorktree: {},
      groupsByWorktree: {},
      unifiedTabsByWorktree: {}
    } as unknown as TargetState
    expect(resolveTerminalOriginGroupId(empty, 'wt-missing', 'chat-terminal')).toBeUndefined()
  })
})

describe('findTerminalOriginGroupId', () => {
  it('returns no group when the origin cannot be identified, leaving fallback to the caller', () => {
    expect(findTerminalOriginGroupId(splitState('group-markdown'), 'wt-1', 'missing-tab')).toBe(
      undefined
    )
  })
})
