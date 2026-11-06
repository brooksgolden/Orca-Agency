import type { TabGroupLayoutNode } from '../../../shared/tab-types'
import {
  collectWorkspaceIds,
  findWorkspaceSplitGroup,
  MAX_WORKSPACE_PANES,
  placeWorkspaceAtEdge,
  type WorkspaceLayoutNode,
  type WorkspaceSplitEdge,
  type WorkspaceSplitGroup
} from './workspace-split-layout'
import { placeWorkspacePane, type WorkspacePanePlacement } from './workspace-pane-placement'

export type WorkspacePaneRef = Extract<WorkspaceLayoutNode, { type: 'leaf' }>
export const workspacePaneKey = (pane: WorkspacePaneRef): string =>
  pane.groupId ? JSON.stringify([pane.workspaceId, pane.groupId]) : pane.workspaceId
export function collectWorkspacePanes(node: WorkspaceLayoutNode): WorkspacePaneRef[] {
  return node.type === 'leaf'
    ? [node]
    : [...collectWorkspacePanes(node.first), ...collectWorkspacePanes(node.second)]
}
export function workspacePaneBounds(
  node: WorkspaceLayoutNode,
  key: string,
  rect = { left: 0, top: 0, width: 1, height: 1 }
): typeof rect | null {
  if (node.type === 'leaf') {
    return workspacePaneKey(node) === key ? rect : null
  }
  const horizontal = node.direction === 'horizontal'
  return (
    workspacePaneBounds(node.first, key, {
      ...rect,
      width: horizontal ? rect.width * node.ratio : rect.width,
      height: horizontal ? rect.height : rect.height * node.ratio
    }) ??
    workspacePaneBounds(node.second, key, {
      left: rect.left + (horizontal ? rect.width * node.ratio : 0),
      top: rect.top + (horizontal ? 0 : rect.height * node.ratio),
      width: horizontal ? rect.width * (1 - node.ratio) : rect.width,
      height: horizontal ? rect.height : rect.height * (1 - node.ratio)
    })
  )
}

function groupTree(workspaceId: string, node: TabGroupLayoutNode): WorkspaceLayoutNode {
  return node.type === 'leaf'
    ? { type: 'leaf', workspaceId, groupId: node.groupId }
    : {
        ...node,
        ratio: node.ratio ?? 0.5,
        first: groupTree(workspaceId, node.first),
        second: groupTree(workspaceId, node.second)
      }
}

export function expandWorkspaceGroups(
  node: WorkspaceLayoutNode,
  workspaceId: string,
  layout: TabGroupLayoutNode
): WorkspaceLayoutNode {
  return node.type === 'leaf'
    ? node.workspaceId === workspaceId && !node.groupId
      ? groupTree(workspaceId, layout)
      : node
    : {
        ...node,
        first: expandWorkspaceGroups(node.first, workspaceId, layout),
        second: expandWorkspaceGroups(node.second, workspaceId, layout)
      }
}

/** Project pane addresses through the existing placement rules without transferring their contents. */
export function placeWorkspaceSurface(
  groups: readonly WorkspaceSplitGroup[],
  layouts: Readonly<Record<string, TabGroupLayoutNode>>,
  source: WorkspacePaneRef,
  target: WorkspacePaneRef,
  edge: WorkspaceSplitEdge,
  newId: string,
  wholeWindow = false,
  placement?: WorkspacePanePlacement
): WorkspaceSplitGroup[] | null {
  if (source.groupId && source.workspaceId !== target.workspaceId) {
    const sourceGroup = findWorkspaceSplitGroup(groups, source.workspaceId)
    const targetGroup = findWorkspaceSplitGroup(groups, target.workspaceId)
    if (
      layouts[source.workspaceId] &&
      collectWorkspacePanes(groupTree(source.workspaceId, layouts[source.workspaceId])).length >
        1 &&
      (!sourceGroup || !targetGroup || sourceGroup.id !== targetGroup.id)
    ) {
      return null
    }
  }
  if (!source.groupId && source.workspaceId === target.workspaceId) {
    const group = findWorkspaceSplitGroup(groups, source.workspaceId)
    const partner =
      group &&
      collectWorkspacePanes(group.layout).find((pane) => pane.workspaceId !== source.workspaceId)
    if (!partner) {
      return null
    }
    target = partner
  }
  if (!target.groupId) {
    const group = findWorkspaceSplitGroup(groups, target.workspaceId)
    target =
      (group &&
        collectWorkspacePanes(group.layout).find(
          (pane) => pane.workspaceId === target.workspaceId
        )) ||
      target
  }
  let expanded = groups.map((group) => ({ ...group }))
  for (const pane of [target, source]) {
    if (!pane.groupId) {
      continue
    }
    const layout = layouts[pane.workspaceId]
    if (!layout) {
      return null
    }
    if (
      !collectWorkspacePanes(groupTree(pane.workspaceId, layout)).some(
        (candidate) => candidate.groupId === pane.groupId
      )
    ) {
      return null
    }
    const existing = findWorkspaceSplitGroup(expanded, pane.workspaceId)
    if (existing) {
      expanded = expanded.map((group) =>
        group.id === existing.id
          ? { ...group, layout: expandWorkspaceGroups(group.layout, pane.workspaceId, layout) }
          : group
      )
    } else {
      expanded.push({
        id: pane.workspaceId === target.workspaceId ? newId : `${newId}:source`,
        layout: groupTree(pane.workspaceId, layout)
      })
    }
  }
  const addresses = new Map<string, WorkspacePaneRef>()
  const encode = (node: WorkspaceLayoutNode): WorkspaceLayoutNode => {
    if (node.type !== 'leaf') {
      return { ...node, first: encode(node.first), second: encode(node.second) }
    }
    const key = workspacePaneKey(node)
    addresses.set(key, node)
    return { type: 'leaf', workspaceId: key }
  }
  const decode = (node: WorkspaceLayoutNode): WorkspaceLayoutNode =>
    node.type === 'leaf'
      ? addresses.get(node.workspaceId)!
      : { ...node, first: decode(node.first), second: decode(node.second) }
  // A whole-workspace drag gathers its fragments instead of leaving duplicate owners behind.
  if (
    !source.groupId &&
    expanded.some((group) =>
      collectWorkspacePanes(group.layout).some(
        (pane) => pane.workspaceId === source.workspaceId && pane.groupId
      )
    )
  ) {
    if (placement?.kind === 'swap') {
      return null
    }
    const prune = (node: WorkspaceLayoutNode): WorkspaceLayoutNode | null => {
      if (node.type === 'leaf') {
        return node.workspaceId === source.workspaceId ? null : node
      }
      const first = prune(node.first),
        second = prune(node.second)
      return first && second ? { ...node, first, second } : (first ?? second)
    }
    expanded = expanded.flatMap((group) => {
      const layout = prune(group.layout)
      return layout ? [{ ...group, layout }] : []
    })
  }
  addresses.set(workspacePaneKey(source), source)
  addresses.set(workspacePaneKey(target), target)
  const encoded = expanded.map((group) => ({ ...group, layout: encode(group.layout) }))
  if (encoded.some((group) => collectWorkspaceIds(group.layout).length > MAX_WORKSPACE_PANES)) {
    return null
  }
  const sourceKey = workspacePaneKey(source),
    targetKey = workspacePaneKey(target)
  const destination = findWorkspaceSplitGroup(encoded, targetKey)
  if (
    destination &&
    !collectWorkspaceIds(destination.layout).includes(sourceKey) &&
    collectWorkspaceIds(destination.layout).length >= MAX_WORKSPACE_PANES
  ) {
    return null
  }
  if (sourceKey === targetKey && !placement && !wholeWindow) {
    return null
  }
  if (
    placement?.kind === 'swap' &&
    (!destination ||
      sourceKey === targetKey ||
      !collectWorkspaceIds(destination.layout).includes(sourceKey))
  ) {
    return null
  }
  const next = placement
    ? placeWorkspacePane(encoded, sourceKey, targetKey, placement, newId)
    : placeWorkspaceAtEdge(encoded, sourceKey, targetKey, edge, newId, wholeWindow)
  return next.map((group) => ({ ...group, layout: decode(group.layout) }))
}
