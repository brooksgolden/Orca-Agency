import type { TabGroupLayoutNode } from '../../../shared/tab-types'
import {
  MAX_WORKSPACE_PANES,
  type WorkspaceLayoutNode,
  type WorkspaceSplitGroup
} from './workspace-split-layout'
import { collectWorkspacePanes } from './workspace-group-layout'

function prune(
  node: WorkspaceLayoutNode,
  workspaceId: string,
  valid: ReadonlySet<string>
): WorkspaceLayoutNode | null {
  if (node.type === 'leaf') {
    return node.workspaceId === workspaceId && node.groupId && !valid.has(node.groupId)
      ? null
      : node
  }
  const first = prune(node.first, workspaceId, valid),
    second = prune(node.second, workspaceId, valid)
  return first && second
    ? first === node.first && second === node.second
      ? node
      : { ...node, first, second }
    : (first ?? second)
}
const ids = (node: TabGroupLayoutNode): string[] =>
  node.type === 'leaf' ? [node.groupId] : [...ids(node.first), ...ids(node.second)]

function branchFor(
  node: TabGroupLayoutNode,
  missing: string,
  present: ReadonlySet<string>
): TabGroupLayoutNode | null {
  if (!ids(node).includes(missing) || !ids(node).some((id) => present.has(id))) {
    return null
  }
  if (node.type === 'leaf') {
    return node
  }
  return branchFor(node.first, missing, present) ?? branchFor(node.second, missing, present) ?? node
}
function project(
  node: TabGroupLayoutNode,
  workspaceId: string,
  allowed: ReadonlySet<string>
): WorkspaceLayoutNode | null {
  if (node.type === 'leaf') {
    return allowed.has(node.groupId) ? { type: 'leaf', workspaceId, groupId: node.groupId } : null
  }
  const first = project(node.first, workspaceId, allowed),
    second = project(node.second, workspaceId, allowed)
  return first && second
    ? { type: 'split', direction: node.direction, ratio: node.ratio ?? 0.5, first, second }
    : (first ?? second)
}
function replace(
  node: WorkspaceLayoutNode,
  workspaceId: string,
  groupId: string,
  replacement: WorkspaceLayoutNode
): WorkspaceLayoutNode {
  return node.type === 'leaf'
    ? node.workspaceId === workspaceId && node.groupId === groupId
      ? replacement
      : node
    : {
        ...node,
        first: replace(node.first, workspaceId, groupId, replacement),
        second: replace(node.second, workspaceId, groupId, replacement)
      }
}

/** Follow genuine tab-group creation/closure while retaining unrelated window geometry. */
export function reconcileWorkspaceGroupLayouts(
  groups: WorkspaceSplitGroup[],
  layouts: Readonly<Record<string, TabGroupLayoutNode>>
): WorkspaceSplitGroup[] {
  let changed = false
  const next = groups.flatMap((group) => {
    let layout: WorkspaceLayoutNode | null = group.layout
    const owners = new Set(
      collectWorkspacePanes(group.layout)
        .filter((pane) => pane.groupId)
        .map((pane) => pane.workspaceId)
    )
    for (const owner of owners) {
      if (!layout) {
        continue
      }
      const local = layouts[owner]
      const valid = new Set(local ? ids(local) : [])
      const surviving = collectWorkspacePanes(layout).some(
        (pane) => pane.workspaceId === owner && pane.groupId && valid.has(pane.groupId)
      )
      if (!surviving) {
        // A regenerated group tree is still the same workspace. Retain its slot and contents.
        let retained = false
        const recover = (node: WorkspaceLayoutNode): WorkspaceLayoutNode | null => {
          if (node.type === 'leaf') {
            if (node.workspaceId !== owner) {
              return node
            }
            if (retained) {
              return null
            }
            retained = true
            return { type: 'leaf', workspaceId: owner }
          }
          const first = recover(node.first),
            second = recover(node.second)
          return first && second ? { ...node, first, second } : (first ?? second)
        }
        layout = recover(layout)
        continue
      }
      if (!local) {
        continue
      }
      layout = prune(layout, owner, valid)
      if (!layout) {
        continue
      }
      const present = new Set(
        collectWorkspacePanes(layout)
          .filter((pane) => pane.workspaceId === owner)
          .map((pane) => pane.groupId!)
      )
      for (const missing of valid) {
        if (present.has(missing)) {
          continue
        }
        const branch = branchFor(local, missing, present)
        const anchor = branch && ids(branch).find((id) => present.has(id))
        if (!branch || !anchor) {
          continue
        }
        const added = ids(branch).filter((id) => id === anchor || !present.has(id))
        const replacement = project(branch, owner, new Set(added))!
        layout = replace(layout, owner, anchor, replacement)
        added.forEach((id) => present.add(id))
      }
      if (collectWorkspacePanes(layout).length > MAX_WORKSPACE_PANES) {
        let retained = false
        const gather = (node: WorkspaceLayoutNode): WorkspaceLayoutNode | null => {
          if (node.type === 'leaf') {
            if (node.workspaceId !== owner) {
              return node
            }
            if (retained) {
              return null
            }
            retained = true
            return { type: 'leaf', workspaceId: owner }
          }
          const first = gather(node.first),
            second = gather(node.second)
          return first && second ? { ...node, first, second } : (first ?? second)
        }
        layout = gather(layout)
      }
    }
    if (layout !== group.layout) {
      changed = true
    }
    return layout?.type === 'split' ? [layout === group.layout ? group : { ...group, layout }] : []
  })
  return changed || next.length !== groups.length ? next : groups
}
