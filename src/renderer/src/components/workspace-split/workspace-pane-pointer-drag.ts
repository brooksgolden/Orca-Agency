export const WORKSPACE_PANE_POINTER_MOVE = 'orca:workspace-pane-pointer-move'
export const WORKSPACE_PANE_POINTER_DROP = 'orca:workspace-pane-pointer-drop'
export const WORKSPACE_PANE_POINTER_CLEAR = 'orca:workspace-pane-pointer-clear'

export type WorkspacePanePointerDetail = {
  sourceId: string
  x: number
  y: number
}

export function readWorkspacePanePointerDetail(event: Event): WorkspacePanePointerDetail | null {
  if (!(event instanceof CustomEvent)) {
    return null
  }
  const detail: unknown = event.detail
  if (
    !detail ||
    typeof detail !== 'object' ||
    !('sourceId' in detail) ||
    typeof detail.sourceId !== 'string' ||
    !('x' in detail) ||
    typeof detail.x !== 'number' ||
    !('y' in detail) ||
    typeof detail.y !== 'number'
  ) {
    return null
  }
  return { sourceId: detail.sourceId, x: detail.x, y: detail.y }
}

export function dispatchWorkspacePanePointerMove(detail: WorkspacePanePointerDetail): void {
  document.dispatchEvent(new CustomEvent(WORKSPACE_PANE_POINTER_MOVE, { detail }))
}

export function dispatchWorkspacePanePointerDrop(detail: WorkspacePanePointerDetail): boolean {
  const event = new CustomEvent(WORKSPACE_PANE_POINTER_DROP, { detail, cancelable: true })
  document.dispatchEvent(event)
  return event.defaultPrevented
}

export function dispatchWorkspacePanePointerClear(): void {
  document.dispatchEvent(new Event(WORKSPACE_PANE_POINTER_CLEAR))
}
