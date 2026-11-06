import { describe, expect, it } from 'vitest'
import type { Repo } from '../../../../shared/repo-types'
import type { Worktree } from '../../../../shared/worktree/types'
import { cloneDefaultWorkspaceStatuses } from '../../../../shared/workspace-statuses'
import {
  buildStatusGroupedSmartComparator,
  buildWorktreeComparator
} from '../../../../shared/sidebar-list/smart-sort'
import type { WorktreeAttention } from '../../../../shared/sidebar-list/smart-attention'

const NOW = Date.parse('2026-09-20T12:00:00Z')
const repos = new Map<string, Repo>()

function worktree(id: string, lastActivityAt: number, workspaceStatus = 'completed'): Worktree {
  return {
    id,
    repoId: 'repo',
    path: `/repo/${id}`,
    branch: `refs/heads/${id}`,
    head: 'abc123',
    isBare: false,
    isMainWorktree: false,
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    isArchived: false,
    comment: '',
    isUnread: false,
    isPinned: false,
    displayName: id,
    sortOrder: 0,
    lastActivityAt,
    workspaceStatus
  }
}

function groupedComparator(attention: Map<string, WorktreeAttention>) {
  return buildStatusGroupedSmartComparator(
    buildWorktreeComparator('smart', repos, NOW, attention),
    NOW,
    cloneDefaultWorkspaceStatuses(),
    attention
  )
}

describe('status-grouped workspace sorting', () => {
  it('orders Done by recency even if an old agent needs attention', () => {
    const old = worktree('old', NOW - 10_000)
    const recent = worktree('recent', NOW - 1_000)
    const attention = new Map<string, WorktreeAttention>([
      [old.id, { cls: 1, attentionTimestamp: NOW - 20_000 }],
      [recent.id, { cls: 5, attentionTimestamp: 0 }]
    ])
    expect([old, recent].sort(groupedComparator(attention)).map((w) => w.id)).toEqual([
      'recent',
      'old'
    ])
  })

  it('partitions lanes in status order so the persisted flat order keeps Done last', () => {
    // Why this matters beyond the lanes: Smart mode persists this flat order as
    // sortOrder, and cold start replays it under groupings that have no lanes.
    const statuses = cloneDefaultWorkspaceStatuses()
    const doneIndex = statuses.findIndex((status) => status.id === 'completed')
    const progressIndex = statuses.findIndex((status) => status.id === 'in-progress')
    expect(progressIndex).toBeLessThan(doneIndex)

    const done = worktree('done', NOW - 1_000, 'completed')
    const active = worktree('active', NOW - 500_000, 'in-progress')
    const attention = new Map<string, WorktreeAttention>()
    expect([done, active].sort(groupedComparator(attention)).map((w) => w.id)).toEqual([
      'active',
      'done'
    ])
  })

  it('counts recent agent completion even if saved activity time is stale', () => {
    const agent = worktree('agent', NOW - 100_000)
    const terminal = worktree('terminal', NOW - 10_000)
    const attention = new Map<string, WorktreeAttention>([
      [agent.id, { cls: 2, attentionTimestamp: NOW - 1_000 }]
    ])
    expect([terminal, agent].sort(groupedComparator(attention)).map((w) => w.id)).toEqual([
      'agent',
      'terminal'
    ])
    const recent = buildWorktreeComparator('recent', repos, NOW, attention)
    expect([terminal, agent].sort(recent).map((w) => w.id)).toEqual(['agent', 'terminal'])
  })
})
