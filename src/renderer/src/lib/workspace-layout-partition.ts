import type { WorkspaceLayoutNode } from './workspace-split-layout'

/** Partition a row/column at an existing pane boundary; never duplicate or cut a pane. */
export function partitionWorkspaceLayout(
  node: WorkspaceLayoutNode,
  direction: 'horizontal' | 'vertical',
  ratio: number
): [WorkspaceLayoutNode, WorkspaceLayoutNode] | null {
  if (node.type === 'leaf' || node.direction !== direction) {
    return null
  }
  if (Math.abs(node.ratio - ratio) < 0.000001) {
    return [node.first, node.second]
  }
  if (ratio < node.ratio) {
    const cut = partitionWorkspaceLayout(node.first, direction, ratio / node.ratio)
    return cut
      ? [cut[0], { ...node, ratio: (node.ratio - ratio) / (1 - ratio), first: cut[1] }]
      : null
  }
  const cut = partitionWorkspaceLayout(
    node.second,
    direction,
    (ratio - node.ratio) / (1 - node.ratio)
  )
  return cut ? [{ ...node, ratio: node.ratio / ratio, second: cut[0] }, cut[1]] : null
}

export function isWorkspaceStrip(
  node: WorkspaceLayoutNode,
  direction: 'horizontal' | 'vertical'
): boolean {
  return (
    node.type === 'leaf' ||
    (node.direction === direction &&
      isWorkspaceStrip(node.first, direction) &&
      isWorkspaceStrip(node.second, direction))
  )
}

/** Choose an existing boundary nearest the window midpoint, including pixel-rounded ratios. */
export function nearestWorkspaceStripBoundary(node: WorkspaceLayoutNode): number {
  const boundaries: number[] = []
  const walk = (part: WorkspaceLayoutNode, start: number, length: number): void => {
    if (part.type === 'leaf') {
      return
    }
    const boundary = start + length * part.ratio
    boundaries.push(boundary)
    walk(part.first, start, length * part.ratio)
    walk(part.second, boundary, length * (1 - part.ratio))
  }
  walk(node, 0, 1)
  return boundaries.reduce(
    (best, next) => (Math.abs(next - 0.5) < Math.abs(best - 0.5) ? next : best),
    boundaries[0] ?? 0.5
  )
}
