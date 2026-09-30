import type { WorkspaceSplitEdge } from '@/lib/workspace-split-layout'

type Bounds = Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>
function nearest(
  bounds: Bounds,
  x: number,
  y: number
): { edge: WorkspaceSplitEdge; distance: number } {
  const edges = [
    { edge: 'left', distance: x - bounds.left },
    { edge: 'right', distance: bounds.right - x },
    { edge: 'top', distance: y - bounds.top },
    { edge: 'bottom', distance: bounds.bottom - y }
  ] as const
  return edges.reduce((best, next) => (next.distance < best.distance ? next : best))
}

/** Outer 24px wraps the whole window; inner edges split only the hovered workspace. */
export function workspaceDropTarget(
  root: Bounds,
  pane: Bounds,
  x: number,
  y: number,
  split: boolean
) {
  const outside = nearest(root, x, y)
  const wholeWindow = split && outside.distance >= 0 && outside.distance <= 24
  return { edge: wholeWindow ? outside.edge : nearest(pane, x, y).edge, wholeWindow }
}
