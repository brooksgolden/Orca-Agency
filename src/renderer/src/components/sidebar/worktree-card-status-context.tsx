import React from 'react'

import { lastEnteredDoneAt } from '@/components/dashboard/agent-finished-timestamp'
import { useNow } from '@/hooks/use-now'
import { formatShortTimeAgo } from '@/lib/short-time-ago'
import { projectGroupIdFromRepoId } from '../../../../shared/folder-workspace-worktree'
import type { WorktreeCardController } from './use-worktree-card-controller'

/** Project identity and the age of the latest finished agent in Status grouping. */
export function WorktreeCardStatusContext({
  card
}: {
  card: WorktreeCardController
}): React.JSX.Element | null {
  const visible = card.groupBy === 'workspace-status' && !card.affiliateListMode
  const now = useNow(30_000, visible)
  if (!visible) {
    return null
  }

  const projectGroupId = card.repo?.projectGroupId ?? projectGroupIdFromRepoId(card.worktree.repoId)
  const projectName =
    card.projectGroups.find((group) => group.id === projectGroupId)?.name ??
    card.repo?.displayName ??
    'Unassigned'
  const latestCompletionAt = card.statusContextAgents.reduce((latest, agent) => {
    if (agent.state !== 'done') {
      return latest
    }
    return Math.max(latest, lastEnteredDoneAt(agent) ?? 0)
  }, 0)
  const latestWorkingAt = card.statusContextAgents.reduce((latest, agent) => {
    if (agent.state !== 'working') {
      return latest
    }
    return Math.max(latest, agent.entry.updatedAt, agent.entry.stateStartedAt)
  }, 0)
  const timestamp = latestWorkingAt || latestCompletionAt || card.worktree.lastActivityAt
  const ageLabel = timestamp > 0 ? formatShortTimeAgo(timestamp, now) : null
  const ageTitle = latestWorkingAt
    ? `Last agent update ${new Date(latestWorkingAt).toLocaleString()}`
    : latestCompletionAt
      ? `Last agent finished ${new Date(latestCompletionAt).toLocaleString()}`
      : timestamp > 0
        ? `Last workspace activity ${new Date(timestamp).toLocaleString()}`
        : undefined

  return (
    <div
      className="flex min-w-0 items-center gap-2 text-[11px] leading-none text-muted-foreground"
      data-worktree-status-context=""
    >
      <span className="min-w-0 flex-1 truncate" title={projectName}>
        {projectName}
      </span>
      {ageLabel && (
        <span className="shrink-0 tabular-nums" title={ageTitle}>
          {ageLabel}
        </span>
      )}
    </div>
  )
}
