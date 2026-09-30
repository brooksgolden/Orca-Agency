import type { WorkspaceSplitEdge } from '@/lib/workspace-split-layout'
import { cn } from '@/lib/utils'

export function WorkspaceDropPreview({ edge }: { edge: WorkspaceSplitEdge }) {
  return (
    <div
      data-workspace-window-drop={edge}
      className={cn(
        'pointer-events-none absolute z-50 border-2 border-primary bg-primary/15',
        edge === 'left' && 'inset-y-0 left-0 w-1/2',
        edge === 'right' && 'inset-y-0 right-0 w-1/2',
        edge === 'top' && 'inset-x-0 top-0 h-1/2',
        edge === 'bottom' && 'inset-x-0 bottom-0 h-1/2'
      )}
    />
  )
}
