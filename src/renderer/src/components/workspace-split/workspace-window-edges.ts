import type { WorkspaceLayoutNode, WorkspaceSplitEdge } from '@/lib/workspace-split-layout'

/** Window chrome belongs only to the outer edge, not every workspace's local corner. */
export function workspaceTouchesWindowEdge(
  node: WorkspaceLayoutNode,
  workspaceId: string,
  edge: WorkspaceSplitEdge
): boolean {
  if (node.type === 'leaf') {
    return node.workspaceId === workspaceId
  }
  if (node.direction === 'horizontal' && (edge === 'left' || edge === 'right')) {
    return workspaceTouchesWindowEdge(edge === 'left' ? node.first : node.second, workspaceId, edge)
  }
  if (node.direction === 'vertical' && (edge === 'top' || edge === 'bottom')) {
    return workspaceTouchesWindowEdge(edge === 'top' ? node.first : node.second, workspaceId, edge)
  }
  return (
    workspaceTouchesWindowEdge(node.first, workspaceId, edge) ||
    workspaceTouchesWindowEdge(node.second, workspaceId, edge)
  )
}
