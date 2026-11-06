import type { WorkspaceLayoutNode, WorkspaceSplitEdge } from '@/lib/workspace-split-layout'

/** Window chrome belongs only to the outer edge, not every workspace's local corner. */
export function workspaceTouchesWindowEdge(
  node: WorkspaceLayoutNode,
  workspaceId: string,
  edge: WorkspaceSplitEdge,
  groupId?: string
): boolean {
  if (node.type === 'leaf') {
    return node.workspaceId === workspaceId && (!groupId || node.groupId === groupId)
  }
  if (node.direction === 'horizontal' && (edge === 'left' || edge === 'right')) {
    return workspaceTouchesWindowEdge(
      edge === 'left' ? node.first : node.second,
      workspaceId,
      edge,
      groupId
    )
  }
  if (node.direction === 'vertical' && (edge === 'top' || edge === 'bottom')) {
    return workspaceTouchesWindowEdge(
      edge === 'top' ? node.first : node.second,
      workspaceId,
      edge,
      groupId
    )
  }
  return (
    workspaceTouchesWindowEdge(node.first, workspaceId, edge, groupId) ||
    workspaceTouchesWindowEdge(node.second, workspaceId, edge, groupId)
  )
}
