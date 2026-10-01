import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useAppStore } from '@/store'
import { findWorkspaceSplitPartner } from '@/lib/workspace-split-layout'
import { activateAndRevealWorkspace } from '@/lib/worktree-activation'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'

export function WorkspacePaneCloseButton({
  worktreeId,
  menuItem = false
}: {
  worktreeId: string
  menuItem?: boolean
}) {
  const partnerId = useAppStore((state) =>
    findWorkspaceSplitPartner(state.workspaceSplitGroups, worktreeId)
  )
  if (!partnerId) {
    return null
  }
  const unsplit = () => {
    if (activateAndRevealWorkspace(partnerId, { revealInSidebar: false }) !== false) {
      useAppStore.getState().unsplitWorkspace(worktreeId)
    }
  }
  if (menuItem) {
    return <DropdownMenuItem onSelect={unsplit}>Remove workspace from split</DropdownMenuItem>
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Remove workspace from split"
          data-workspace-unsplit-button={worktreeId}
          onClick={(event) => {
            event.stopPropagation()
            unsplit()
          }}
        >
          <X className="size-3.5" aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Remove workspace from split</TooltipContent>
    </Tooltip>
  )
}
