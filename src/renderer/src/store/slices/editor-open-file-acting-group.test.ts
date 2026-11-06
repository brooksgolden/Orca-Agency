import { describe, expect, it } from 'vitest'
import type { StoreApi } from 'zustand'
import { createEditorTabsStore } from './editor-slice-test-harness'
import type { AppState } from '../types'

// Plus-menu scenario: a file outside the worktree opened from a non-active split pane.
// Tab-create-entry passes targetGroupId; this checks the store keeps it and the tab's
// worktree stays the acting workspace.
function seedSplitWorkspace(store: StoreApi<AppState>): {
  chatGroupId: string
  markdownGroupId: string
} {
  store.getState().createUnifiedTab('wt-1', 'terminal', {
    id: 'chat-terminal',
    entityId: 'chat-terminal',
    label: 'Chat'
  })
  const chatGroupId = store.getState().groupsByWorktree['wt-1']?.[0]?.id
  if (!chatGroupId) {
    throw new Error('Expected chat group')
  }
  const markdownGroupId = store.getState().createEmptySplitGroup('wt-1', chatGroupId, 'right')
  if (!markdownGroupId) {
    throw new Error('Expected split group')
  }
  store.setState({
    activeGroupIdByWorktree: { 'wt-1': markdownGroupId },
    activeTabType: 'editor',
    activeTabTypeByWorktree: { 'wt-1': 'editor' }
  } as Partial<AppState>)
  return { chatGroupId, markdownGroupId }
}

describe('plus-menu absolute file open keeps the acting pane', () => {
  it('places a file outside the worktree in the requested non-active group', () => {
    const store = createEditorTabsStore()
    const { chatGroupId } = seedSplitWorkspace(store)

    store.getState().openFile(
      {
        filePath: '/Users/example-user/dev/claude/Example Capital/plan.md',
        relativePath: '/Users/example-user/dev/claude/Example Capital/plan.md',
        worktreeId: 'wt-1',
        language: 'markdown',
        mode: 'edit'
      },
      { preview: false, targetGroupId: chatGroupId }
    )

    const tab = store
      .getState()
      .unifiedTabsByWorktree['wt-1']?.find(
        (candidate) =>
          candidate.entityId === '/Users/example-user/dev/claude/Example Capital/plan.md'
      )
    expect(tab?.groupId).toBe(chatGroupId)
    expect(tab?.worktreeId).toBe('wt-1')
  })

  it('keeps the tab in the requested group when a runtime environment is active', () => {
    const store = createEditorTabsStore()
    const { chatGroupId } = seedSplitWorkspace(store)
    store.setState({
      settings: { activeRuntimeEnvironmentId: 'env-remote' }
    } as unknown as Partial<AppState>)

    store.getState().openFile(
      {
        filePath: '/Users/example-user/dev/claude/Example Capital/plan.md',
        relativePath: '/Users/example-user/dev/claude/Example Capital/plan.md',
        worktreeId: 'wt-1',
        language: 'markdown',
        mode: 'edit'
      },
      { preview: false, targetGroupId: chatGroupId }
    )

    const tab = store
      .getState()
      .unifiedTabsByWorktree['wt-1']?.find(
        (candidate) =>
          candidate.entityId === '/Users/example-user/dev/claude/Example Capital/plan.md'
      )
    expect(tab?.groupId).toBe(chatGroupId)
    expect(tab?.worktreeId).toBe('wt-1')
  })
})
