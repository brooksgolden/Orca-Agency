import type { FolderWorkspace } from '../../../../../../shared/folder-workspace-types'
import type { ProjectGroup } from '../../../../../../shared/project-group-types'
import type { Repo } from '../../../../../../shared/repo-types'
import type { ProjectOrderBy } from '../../../../../../shared/ui-chrome-types'
import type { WorktreeLineage } from '../../../../../../shared/worktree/lineage-types'
import type { WorkspaceStatusDefinition, Worktree } from '../../../../../../shared/worktree/types'
import { cloneDefaultWorkspaceStatuses } from '../../../../../../shared/workspace-statuses'
import type { AppState } from '../../../../store/types'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../../../shared/execution-host'
import type { ExecutionHostId } from '../../../../../../shared/execution-host'
import type { ProjectGroupingModel } from '../../../../../../shared/project-section-grouping'
import {
  getPinnedWorktreeDisplayPolicy,
  type ImportedWorktreesCardCandidate,
  type NewExternalWorktreesInboxCandidate,
  type PendingCreationRef,
  type PinnedWorktreeDisplayPolicy,
  type Row,
  type WorktreeGroupBy
} from '../../../../../../shared/sidebar-list/row-types'
import { planSidebarRows } from '../../../../../../shared/sidebar-list/sidebar-row-plan'
import type { PRCacheView } from '../../../../../../shared/sidebar-list/workspace-review-facts'
import { createSidebarPRGroupReader } from './pr-group-key'

/**
 * Thin positional adapter over the shared row plan. Renderer callers and tests keep
 * this signature; every rule (pinned section, folder lanes, status lanes, lineage
 * nesting, host labels) lives in shared/sidebar-list/sidebar-row-plan.ts.
 */
export function buildSidebarRowPlan(
  groupBy: WorktreeGroupBy,
  worktrees: Worktree[],
  repoMap: Map<string, Repo>,
  prCache: PRCacheView | null,
  _collapsedGroups: Set<string>,
  repoOrder?: Map<string, number>,
  workspaceStatuses: readonly WorkspaceStatusDefinition[] = cloneDefaultWorkspaceStatuses(),
  projectOrderBy: ProjectOrderBy = 'manual',
  lineageById: Record<string, WorktreeLineage> = {},
  worktreeMap = new Map<string, Worktree>(worktrees.map((worktree) => [worktree.id, worktree])),
  nestLineage = false,
  settings?: AppState['settings'],
  projectGroups: readonly ProjectGroup[] = [],
  placeholderRepoIds: ReadonlySet<string> = new Set(),
  importedWorktreesByRepo: ReadonlyMap<string, ImportedWorktreesCardCandidate> = new Map(),
  newExternalWorktreesInboxByRepo: ReadonlyMap<
    string,
    NewExternalWorktreesInboxCandidate
  > = new Map(),
  pendingCreations: readonly PendingCreationRef[] = [],
  projectGrouping?: ProjectGroupingModel,
  folderWorkspaces: readonly FolderWorkspace[] = [],
  hostLabelById?: ReadonlyMap<string, string>,
  defaultHostId: ExecutionHostId = LOCAL_EXECUTION_HOST_ID,
  pinnedDisplayPolicy: PinnedWorktreeDisplayPolicy = getPinnedWorktreeDisplayPolicy(settings),
  statusLaneComparator?: (a: Worktree, b: Worktree) => number,
  filterRepoIds: readonly string[] = []
) {
  return planSidebarRows({
    groupBy,
    worktrees,
    repoMap,
    prGroupOf: createSidebarPRGroupReader(repoMap, prCache),
    repoOrder,
    workspaceStatuses,
    projectOrderBy,
    lineageById,
    worktreeMap,
    nestLineage,
    projectGroups,
    placeholderRepoIds,
    importedWorktreesByRepo,
    newExternalWorktreesInboxByRepo,
    pendingCreations,
    projectGrouping,
    folderWorkspaces,
    hostLabelById,
    defaultHostId,
    pinnedDisplayPolicy,
    filterRepoIds,
    statusLaneComparator
  })
}

export function buildRows(...args: Parameters<typeof buildSidebarRowPlan>): Row[] {
  return buildSidebarRowPlan(...args).render(args[4])
}
