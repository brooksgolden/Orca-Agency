// Adapted from whyjp's worktree layout tree in stablyai/orca#8379 for the
// current workbench. Leaves are complete workspaces, each with its own tabs.
export type WorkspaceLayoutNode =
  | { type: 'leaf'; workspaceId: string }
  | {
      type: 'split'
      direction: 'horizontal' | 'vertical'
      first: WorkspaceLayoutNode
      second: WorkspaceLayoutNode
      ratio: number
    }

export type WorkspaceSplitGroup = { id: string; layout: WorkspaceLayoutNode }
export type WorkspaceSplitEdge = 'left' | 'right' | 'top' | 'bottom'
export type WorkspaceLayoutPath = readonly ('first' | 'second')[]
export const MAX_WORKSPACE_PANES = 16
const STORAGE_KEY = 'orca.workspaceSplitGroups.v1'

export function collectWorkspaceIds(node: WorkspaceLayoutNode): string[] {
  return node.type === 'leaf'
    ? [node.workspaceId]
    : [...collectWorkspaceIds(node.first), ...collectWorkspaceIds(node.second)]
}

export function findWorkspaceSplitGroup(
  groups: readonly WorkspaceSplitGroup[] | undefined,
  workspaceId: string | null
): WorkspaceSplitGroup | null {
  // Why the array guard: this runs during the workspace context menu's render,
  // so any caller whose store has not produced the split slice yet would throw
  // inside React and take the whole menu down with it. An absent slice means
  // no splits, which is exactly what a null answer says.
  if (!workspaceId || !Array.isArray(groups)) {
    return null
  }
  return groups.find((group) => collectWorkspaceIds(group.layout).includes(workspaceId)) ?? null
}

export function findWorkspaceSplitPartner(
  groups: readonly WorkspaceSplitGroup[] | undefined,
  workspaceId: string
): string | null {
  const group = findWorkspaceSplitGroup(groups, workspaceId)
  return group ? (collectWorkspaceIds(group.layout).find((id) => id !== workspaceId) ?? null) : null
}

function removeLeaf(node: WorkspaceLayoutNode, id: string): WorkspaceLayoutNode | null {
  if (node.type === 'leaf') {
    return node.workspaceId === id ? null : node
  }
  const first = removeLeaf(node.first, id)
  const second = removeLeaf(node.second, id)
  if (!first) {
    return second
  }
  if (!second) {
    return first
  }
  return first === node.first && second === node.second ? node : { ...node, first, second }
}

function splitLeaf(
  node: WorkspaceLayoutNode,
  targetId: string,
  sourceId: string,
  edge: WorkspaceSplitEdge
): WorkspaceLayoutNode {
  if (node.type === 'leaf') {
    if (node.workspaceId !== targetId) {
      return node
    }
    const source: WorkspaceLayoutNode = { type: 'leaf', workspaceId: sourceId }
    const before = edge === 'left' || edge === 'top'
    return {
      type: 'split',
      direction: edge === 'left' || edge === 'right' ? 'horizontal' : 'vertical',
      first: before ? source : node,
      second: before ? node : source,
      ratio: 0.5
    }
  }
  return {
    ...node,
    first: splitLeaf(node.first, targetId, sourceId, edge),
    second: splitLeaf(node.second, targetId, sourceId, edge)
  }
}

export function placeWorkspaceAtEdge(
  groups: readonly WorkspaceSplitGroup[],
  sourceId: string,
  targetId: string,
  edge: WorkspaceSplitEdge,
  newGroupId: string,
  wholeWindow = false
): WorkspaceSplitGroup[] {
  if (!sourceId || !targetId || sourceId === targetId) {
    return [...groups]
  }
  const target = findWorkspaceSplitGroup(groups, targetId)
  if (target && !collectWorkspaceIds(target.layout).includes(sourceId)) {
    if (collectWorkspaceIds(target.layout).length >= MAX_WORKSPACE_PANES) {
      return [...groups]
    }
  }
  const remaining = groups
    .map((group) => ({ ...group, layout: removeLeaf(group.layout, sourceId) }))
    .filter((group): group is WorkspaceSplitGroup => group.layout !== null)
    .filter((group) => collectWorkspaceIds(group.layout).length >= 2)
  const targetAfterMove = findWorkspaceSplitGroup(remaining, targetId)
  if (targetAfterMove) {
    return remaining.map((group) =>
      group.id === targetAfterMove.id
        ? {
            ...group,
            layout: wholeWindow
              ? {
                  type: 'split',
                  direction: edge === 'left' || edge === 'right' ? 'horizontal' : 'vertical',
                  first:
                    edge === 'left' || edge === 'top'
                      ? { type: 'leaf', workspaceId: sourceId }
                      : group.layout,
                  second:
                    edge === 'left' || edge === 'top'
                      ? group.layout
                      : { type: 'leaf', workspaceId: sourceId },
                  ratio: 0.5
                }
              : splitLeaf(group.layout, targetId, sourceId, edge)
          }
        : group
    )
  }
  const layout = splitLeaf({ type: 'leaf', workspaceId: targetId }, targetId, sourceId, edge)
  return [...remaining, { id: newGroupId, layout }]
}

export function removeWorkspaceFromSplit(
  groups: readonly WorkspaceSplitGroup[],
  workspaceId: string
): WorkspaceSplitGroup[] {
  return groups
    .map((group) => ({ ...group, layout: removeLeaf(group.layout, workspaceId) }))
    .filter((group): group is WorkspaceSplitGroup => group.layout !== null)
    .filter((group) => collectWorkspaceIds(group.layout).length >= 2)
}

export function setWorkspaceSplitRatio(
  groups: readonly WorkspaceSplitGroup[],
  groupId: string,
  path: WorkspaceLayoutPath,
  ratio: number
): WorkspaceSplitGroup[] {
  const update = (node: WorkspaceLayoutNode, rest: WorkspaceLayoutPath): WorkspaceLayoutNode => {
    if (node.type !== 'split') {
      return node
    }
    if (rest.length === 0) {
      return { ...node, ratio: Math.max(0.15, Math.min(0.85, ratio)) }
    }
    const [side, ...tail] = rest
    return { ...node, [side]: update(node[side], tail) }
  }
  return groups.map((group) =>
    group.id === groupId ? { ...group, layout: update(group.layout, path) } : group
  )
}

function parseNode(value: unknown, seen: Set<string>, depth = 0): WorkspaceLayoutNode | null {
  if (!value || typeof value !== 'object' || depth > MAX_WORKSPACE_PANES * 2) {
    return null
  }
  const type: unknown = Reflect.get(value, 'type')
  const workspaceId: unknown = Reflect.get(value, 'workspaceId')
  if (type === 'leaf' && typeof workspaceId === 'string' && workspaceId.length > 0) {
    if (seen.has(workspaceId) || seen.size >= MAX_WORKSPACE_PANES) {
      return null
    }
    seen.add(workspaceId)
    return { type: 'leaf', workspaceId }
  }
  if (type !== 'split') {
    return null
  }
  const first = parseNode(Reflect.get(value, 'first'), seen, depth + 1)
  const second = parseNode(Reflect.get(value, 'second'), seen, depth + 1)
  if (!first) {
    return second
  }
  if (!second) {
    return first
  }
  const direction: unknown = Reflect.get(value, 'direction')
  const ratio: unknown = Reflect.get(value, 'ratio')
  return {
    type: 'split',
    direction: direction === 'vertical' ? 'vertical' : 'horizontal',
    first,
    second,
    ratio:
      typeof ratio === 'number' && Number.isFinite(ratio)
        ? Math.max(0.15, Math.min(0.85, ratio))
        : 0.5
  }
}

export function readWorkspaceSplitGroups(): WorkspaceSplitGroup[] {
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]')
    if (!Array.isArray(stored)) {
      return []
    }
    const used = new Set<string>()
    return stored.flatMap((candidate: unknown) => {
      if (!candidate || typeof candidate !== 'object') {
        return []
      }
      const id: unknown = Reflect.get(candidate, 'id')
      const layout = parseNode(Reflect.get(candidate, 'layout'), new Set())
      if (typeof id !== 'string' || !layout) {
        return []
      }
      const ids = collectWorkspaceIds(layout)
      if (ids.length < 2 || ids.some((id) => used.has(id))) {
        return []
      }
      ids.forEach((id) => used.add(id))
      return [{ id, layout }]
    })
  } catch {
    return []
  }
}

export function writeWorkspaceSplitGroups(groups: readonly WorkspaceSplitGroup[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(groups))
  } catch {
    // Retain the current session's arrangement when storage is unavailable.
  }
}
