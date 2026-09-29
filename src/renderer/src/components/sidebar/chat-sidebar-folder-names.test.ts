import { describe, expect, it } from 'vitest'
import { folderDisplayNameMode } from '../../../../shared/worktree/folder-display-name-mode'
import type { WorktreeMeta } from '../../../../shared/worktree/meta-types'
import { buildChatSidebarRows } from './chat-sidebar-rows'
import { chatState, chatTab, chatWorktree } from './chat-sidebar-test-fixtures'

describe.each(['local', 'ssh:test'] as const)('folder chat names (%#)', (hostId) => {
  function rows(metadata: Partial<WorktreeMeta>) {
    const state = chatState()
    const meta = {
      displayName: 'coho',
      comment: '',
      linkedIssue: null,
      linkedPR: null,
      linkedLinearIssue: null,
      isArchived: false,
      isUnread: false,
      isPinned: false,
      sortOrder: 0,
      lastActivityAt: 0,
      ...metadata
    }
    const worktree = {
      ...chatWorktree,
      hostId,
      displayName: meta.displayName,
      displayNameMode: folderDisplayNameMode(meta)
    }
    state.worktreesByRepo = { [worktree.repoId]: [worktree] }
    state.tabsByWorktree = {
      [worktree.id]: [
        chatTab('webinar', {
          aiVaultTitle: {
            agent: 'codex',
            sessionId: 'session-webinar',
            title: 'Set Krisp to record webinar'
          }
        })
      ]
    }
    return buildChatSidebarRows(state, [], 10_000)
  }

  it('replaces an existing random workspace name with the provider chat title', () => {
    expect(rows({})[0].title).toBe('Set Krisp to record webinar')
    expect(rows({ displayName: 'seaslug-2' })[0].title).toBe('Set Krisp to record webinar')
  })

  it('keeps a deliberately chosen creature name and an existing descriptive name', () => {
    expect(rows({ displayNameIsPinned: true })[0].title).toBe('coho')
    expect(rows({ displayName: 'Aside profile extensions' })[0].title).toBe(
      'Aside profile extensions'
    )
    expect(rows({ cliProvenance: { kind: 'created-by-cli', createdAt: 1 } })[0].title).toBe('coho')
  })

  it('returns an unpinned label to the provider title', () => {
    expect(rows({ displayName: 'Old generated title', displayNameIsPinned: false })[0].title).toBe(
      'Set Krisp to record webinar'
    )
  })
})
