import type { WorkspaceSplitEdge } from '@/lib/workspace-split-layout'

type Bounds = Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>
function nearest(
  bounds: Bounds,
  x: number,
  y: number,
  normalized = false
): { edge: WorkspaceSplitEdge; distance: number } {
  const width = normalized ? Math.max(1, bounds.right - bounds.left) : 1
  const height = normalized ? Math.max(1, bounds.bottom - bounds.top) : 1
  const edges = [
    { edge: 'top', distance: (y - bounds.top) / height },
    { edge: 'bottom', distance: (bounds.bottom - y) / height },
    { edge: 'left', distance: (x - bounds.left) / width },
    { edge: 'right', distance: (bounds.right - x) / width }
  ] as const
  return edges.reduce((best, next) => (next.distance < best.distance ? next : best))
}

/** Full-span pane corners stay local; outer edge midpoints wrap the whole window. */
export function workspaceDropTarget(
  root: Bounds,
  pane: Bounds,
  x: number,
  y: number,
  split: boolean
) {
  const outside = nearest(root, x, y)
  const localX = (x - pane.left) / Math.max(1, pane.right - pane.left)
  const localY = (y - pane.top) / Math.max(1, pane.bottom - pane.top)
  const fullHeight = Math.abs(pane.top - root.top) <= 1 && Math.abs(pane.bottom - root.bottom) <= 1
  const fullWidth = Math.abs(pane.left - root.left) <= 1 && Math.abs(pane.right - root.right) <= 1
  const cornerEdge =
    split && fullHeight && !fullWidth && (localY <= 0.25 || localY >= 0.75)
      ? localY < 0.5
        ? 'top'
        : 'bottom'
      : split && fullWidth && !fullHeight && (localX <= 0.25 || localX >= 0.75)
        ? localX < 0.5
          ? 'left'
          : 'right'
        : null
  const wholeWindow =
    split &&
    (!cornerEdge || cornerEdge === outside.edge) &&
    outside.distance >= 0 &&
    outside.distance <= 24
  return {
    edge: wholeWindow ? outside.edge : (cornerEdge ?? nearest(pane, x, y, true).edge),
    wholeWindow
  }
}
