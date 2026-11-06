import {
  collectWorkspaceIds,
  findWorkspaceSplitGroup,
  placeWorkspaceAtEdge,
  removeWorkspaceFromSplit,
  type WorkspaceLayoutNode,
  type WorkspaceSplitGroup
} from './workspace-split-layout'
import {
  isWorkspaceStrip,
  partitionWorkspaceLayout,
  nearestWorkspaceStripBoundary
} from './workspace-layout-partition'

export type WorkspaceQuadrant = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
export type WorkspacePanePlacement =
  | { kind: 'swap' }
  | { kind: 'quadrant'; quadrant: WorkspaceQuadrant }

const leaf = (workspaceId: string): WorkspaceLayoutNode => ({ type: 'leaf', workspaceId })
const pair = (
  direction: 'horizontal' | 'vertical',
  first: WorkspaceLayoutNode | undefined,
  second: WorkspaceLayoutNode | undefined
): WorkspaceLayoutNode | undefined =>
  first && second ? { type: 'split', direction, first, second, ratio: 0.5 } : (first ?? second)

function placeInWholeQuadrantHalf(
  layout: WorkspaceLayoutNode,
  source: string,
  quadrant: WorkspaceQuadrant
): WorkspaceLayoutNode | null {
  if (layout.type !== 'split') {
    return null
  }
  if (isWorkspaceStrip(layout, layout.direction)) {
    const boundary = nearestWorkspaceStripBoundary(layout)
    const half = partitionWorkspaceLayout(layout, layout.direction, boundary)
    if (half) {
      layout = { ...layout, ratio: boundary, first: half[0], second: half[1] }
    }
  }
  const horizontal = layout.direction === 'horizontal'
  const side = horizontal
    ? quadrant.endsWith('left')
      ? 'first'
      : 'second'
    : quadrant.startsWith('top')
      ? 'first'
      : 'second'
  const removeSource = (node: WorkspaceLayoutNode): WorkspaceLayoutNode | null => {
    if (node.type === 'leaf') {
      return node.workspaceId === source ? null : node
    }
    const first = removeSource(node.first),
      second = removeSource(node.second)
    return first && second ? { ...node, first, second } : (first ?? second)
  }
  const selected = removeSource(layout[side])
  const opposite = side === 'first' ? 'second' : 'first'
  const retainedOpposite = removeSource(layout[opposite])
  if (!selected || !retainedOpposite) {
    return null
  }
  const crossDirection = horizontal ? 'vertical' : 'horizontal'
  const before = horizontal ? quadrant.startsWith('top') : quadrant.endsWith('left')
  return {
    ...layout,
    [opposite]: retainedOpposite,
    [side]: pair(
      crossDirection,
      before ? leaf(source) : selected,
      before ? selected : leaf(source)
    )!
  }
}

/** Exchange occupied slots without changing split sizes or touching their terminals. */
export function placeWorkspacePane(
  groups: readonly WorkspaceSplitGroup[],
  source: string,
  target: string,
  placement: WorkspacePanePlacement,
  newGroupId: string
): WorkspaceSplitGroup[] {
  const destination = findWorkspaceSplitGroup(groups, target)
  if (!source || !destination) {
    return [...groups]
  }
  if (placement.kind === 'swap') {
    if (source === target || !collectWorkspaceIds(destination.layout).includes(source)) {
      return [...groups]
    }
    const swap = (node: WorkspaceLayoutNode): WorkspaceLayoutNode =>
      node.type === 'leaf'
        ? leaf(
            node.workspaceId === source
              ? target
              : node.workspaceId === target
                ? source
                : node.workspaceId
          )
        : { ...node, first: swap(node.first), second: swap(node.second) }
    return groups.map((group) =>
      group.id === destination.id ? { ...group, layout: swap(group.layout) } : group
    )
  }
  const remaining = removeWorkspaceFromSplit(groups, source)
  const base = remaining.find((group) => group.id === destination.id)
  const preserved =
    placeInWholeQuadrantHalf(destination.layout, source, placement.quadrant) ??
    (base && placeInWholeQuadrantHalf(base.layout, source, placement.quadrant))
  if (preserved) {
    return remaining.map((group) =>
      group.id === destination.id ? { ...group, layout: preserved } : group
    )
  }
  const partner =
    target === source ? collectWorkspaceIds(destination.layout).find((id) => id !== source) : target
  return partner
    ? placeWorkspaceAtEdge(
        groups,
        source,
        partner,
        placement.quadrant.endsWith('right') ? 'right' : 'left',
        newGroupId
      )
    : [...groups]
}
