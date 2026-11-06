import type { Repo } from '../repo-types'
import type { WorktreeOccurrencePlan } from '../worktree-occurrence-plan'
import type { WorkspaceStatusDefinition, Worktree } from '../worktree/types'
import type { ExecutionHostId } from '../execution-host'
import { getWorkspaceStatusFromGroupKey } from '../workspace-statuses'
import type { PRGroupKey } from './group-keys'
import type { NoticeHostContext } from './host-labels'
import {
  getHostWorktreeIds,
  getLaneHostWorktreeCounts,
  getLaneHostWorktreeIds,
  getMixedHostContextLabels,
  getProjectHeaderHostRepos
} from './host-labels'
import type { OrderedGroupEntry, WorktreeGroupEntry } from './worktree-group-entry'
import type { ProjectGroupingIndex } from '../project-section-grouping'
import {
  appendWorktreeRows,
  buildFolderWorkspaceRow,
  buildImportedWorktreesCardRow,
  buildNewExternalWorktreesInboxRow,
  buildPendingCreationRow
} from './row-builders'
import type {
  ImportedWorktreesCardCandidate,
  NewExternalWorktreesInboxCandidate,
  PendingCreationRef,
  GroupHeaderRow,
  RepoOfWorktree,
  Row,
  WorktreeGroupBy
} from './row-types'
import { folderWorkspaceToWorktree } from '../folder-workspace-worktree'

/** Everything section emission reads that stays fixed for one planSidebarRows call. */
export type SectionAppendContext = {
  statusLaneComparator?: (a: Worktree, b: Worktree) => number
  result: Row[]
  groupBy: WorktreeGroupBy
  collapsedGroups: Set<string>
  workspaceStatuses: readonly WorkspaceStatusDefinition[]
  repoMap: Map<string, Repo>
  repoOf: RepoOfWorktree
  defaultHostId: ExecutionHostId
  hostLabelById: ReadonlyMap<string, string> | undefined
  projectIndex: ProjectGroupingIndex | null
  importedWorktreesByRepo: ReadonlyMap<string, ImportedWorktreesCardCandidate>
  newExternalWorktreesInboxByRepo: ReadonlyMap<string, NewExternalWorktreesInboxCandidate>
  pendingByRepo: ReadonlyMap<string, PendingCreationRef[]>
  mixedWorktreeHostContextLabels: Map<string, string> | undefined
  noticeHostContextLabelByRepoId: Map<string, NoticeHostContext> | undefined
  occurrencePlan: WorktreeOccurrencePlan<Worktree>
}

function getProjectHeaderHostScope(
  ctx: SectionAppendContext,
  group: WorktreeGroupEntry
): Pick<GroupHeaderRow, 'hostRepos' | 'hostWorktreeCounts' | 'hostWorktreeIds'> {
  const hostRepos = getProjectHeaderHostRepos({
    group,
    repoMap: ctx.repoMap,
    repoOf: ctx.repoOf,
    noticeRepoOf: (repoId) =>
      [
        ctx.importedWorktreesByRepo.get(repoId)?.repo,
        ctx.newExternalWorktreesInboxByRepo.get(repoId)?.repo
      ].filter((repo) => repo !== undefined),
    hasPendingCreation: (repoId) => ctx.pendingByRepo.has(repoId),
    defaultHostId: ctx.defaultHostId
  })
  if (!hostRepos) {
    return {}
  }
  const hostWorktreeIds = getHostWorktreeIds(group.items, ctx.repoOf, ctx.defaultHostId)
  return {
    hostRepos,
    hostWorktreeCounts: hostWorktreeIds
      ? new Map([...hostWorktreeIds].map(([hostId, ids]) => [hostId, ids.length]))
      : undefined,
    hostWorktreeIds
  }
}

export function appendOrderedGroups(
  ctx: SectionAppendContext,
  groupsToAppend: OrderedGroupEntry[],
  projectGroupDepth = 0
): void {
  const {
    result,
    groupBy,
    collapsedGroups,
    workspaceStatuses,
    repoMap,
    repoOf,
    defaultHostId,
    hostLabelById,
    projectIndex,
    importedWorktreesByRepo,
    newExternalWorktreesInboxByRepo,
    pendingByRepo,
    mixedWorktreeHostContextLabels,
    occurrencePlan
  } = ctx
  for (const [key, group] of groupsToAppend) {
    const isCollapsed = collapsedGroups.has(key)
    const repo = group.repo
    const folderPairs = group.folderWorkspaces ?? []
    const header =
      groupBy === 'repo'
        ? {
            type: 'header' as const,
            key,
            label: group.label,
            count: group.items.length,
            icon: { kind: 'project' as const },
            repo,
            projectGroupDepth,
            ...getProjectHeaderHostScope(ctx, group)
          }
        : groupBy === 'workspace-status'
          ? (() => {
              const workspaceStatus =
                getWorkspaceStatusFromGroupKey(key, workspaceStatuses) ??
                workspaceStatuses[0]?.id ??
                'in-progress'
              const definition = workspaceStatuses.find((status) => status.id === workspaceStatus)
              return {
                type: 'header' as const,
                key,
                label: definition?.label ?? workspaceStatus,
                count: group.items.length + folderPairs.length,
                icon: { kind: 'workspace-status' as const, status: workspaceStatus },
                hostWorktreeCounts: getLaneHostWorktreeCounts(
                  group.items,
                  folderPairs,
                  repoOf,
                  defaultHostId
                ),
                hostWorktreeIds: getLaneHostWorktreeIds(
                  group.items,
                  folderPairs,
                  repoOf,
                  defaultHostId
                ),
                worktreeIds: group.items.map((worktree) => worktree.id)
              }
            })()
          : (() => {
              const prGroup = key.replace(/^pr:/, '') as PRGroupKey
              return {
                type: 'header' as const,
                key,
                count: group.items.length + folderPairs.length,
                icon: { kind: 'pr-status' as const, prGroup },
                hostWorktreeCounts: getLaneHostWorktreeCounts(
                  group.items,
                  folderPairs,
                  repoOf,
                  defaultHostId
                ),
                hostWorktreeIds: getLaneHostWorktreeIds(
                  group.items,
                  folderPairs,
                  repoOf,
                  defaultHostId
                ),
                worktreeIds: group.items.map((worktree) => worktree.id)
              }
            })()

    result.push(header)
    if (!isCollapsed) {
      if (groupBy === 'repo') {
        const repoIds =
          group.repoIds.size > 0
            ? [...group.repoIds]
            : repo
              ? [repo.id]
              : key.startsWith('repo:')
                ? [key.slice('repo:'.length)]
                : []
        for (const repoId of repoIds) {
          const candidate = importedWorktreesByRepo.get(repoId)
          if (candidate) {
            result.push(
              buildImportedWorktreesCardRow(
                candidate,
                'repo-group',
                ctx.noticeHostContextLabelByRepoId?.get(repoId)
              )
            )
          }
        }
        for (const repoId of repoIds) {
          const candidate = newExternalWorktreesInboxByRepo.get(repoId)
          if (candidate) {
            result.push(
              buildNewExternalWorktreesInboxRow(
                candidate,
                ctx.noticeHostContextLabelByRepoId?.get(repoId)
              )
            )
          }
        }
        // Place in-progress creates atop their own repo so the workspace appears where it will land.
        for (const repoId of repoIds) {
          for (const creation of pendingByRepo.get(repoId) ?? []) {
            result.push(buildPendingCreationRow(creation, repoMap))
          }
        }
      }
      const hostContextLabelByRepoId =
        groupBy === 'repo'
          ? getMixedHostContextLabels(group, repoMap, projectIndex, hostLabelById)
          : undefined
      // Why (STA-4343): repo grouping normally labels by repo, but one repo id can
      // be registered on two hosts — then every row in the group shares a repo id
      // and the per-repo label cannot tell them apart. Fall back to the per-row
      // host labels, which are keyed by host-qualified identity.
      const hostContextLabelByWorktreeIdentity =
        groupBy === 'repo' && hostContextLabelByRepoId ? undefined : mixedWorktreeHostContextLabels
      const laneStart = result.length
      appendWorktreeRows(result, repoOf, occurrencePlan, {
        collapsedGroups,
        groupDepth: projectGroupDepth,
        sectionKey: key,
        hostContextLabelByRepoId,
        hostContextLabelByWorktreeIdentity
      })
      const compare = groupBy === 'workspace-status' ? ctx.statusLaneComparator : undefined
      const orderedFolders = compare
        ? [...folderPairs].sort((a, b) =>
            compare(
              folderWorkspaceToWorktree(a.folderWorkspace),
              folderWorkspaceToWorktree(b.folderWorkspace)
            )
          )
        : folderPairs
      for (const pair of orderedFolders) {
        const row = buildFolderWorkspaceRow(pair, projectGroupDepth)
        const folder = folderWorkspaceToWorktree(pair.folderWorkspace)
        // Insert at root boundaries so existing parent/child blocks stay together.
        const index = compare
          ? result.findIndex(
              (candidate, index) =>
                index >= laneStart &&
                ((candidate.type === 'item' &&
                  candidate.depth === 0 &&
                  compare(folder, candidate.worktree) < 0) ||
                  (candidate.type === 'folder-workspace' &&
                    compare(folder, folderWorkspaceToWorktree(candidate.folderWorkspace)) < 0))
            )
          : -1
        if (index < 0) {
          result.push(row)
        } else {
          result.splice(index, 0, row)
        }
      }
    }
  }
}
