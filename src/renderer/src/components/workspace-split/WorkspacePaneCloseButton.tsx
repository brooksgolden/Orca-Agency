import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useAppStore } from '@/store'
import { findWorkspaceSplitGroup, findWorkspaceSplitPartner } from '@/lib/workspace-split-layout'
import { activateAndRevealWorkspace } from '@/lib/worktree-activation'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { useConfirmationDialog } from '@/components/confirmation-dialog-context'
import { setWorkspaceChatsCompleted } from '@/components/sidebar/chat-sidebar-preferences'
import { translate } from '@/i18n/i18n'

export function WorkspacePaneCloseButton({
  worktreeId,
  menuItem = false
}: {
  worktreeId: string
  menuItem?: boolean
}) {
  const confirm = useConfirmationDialog()
  const isWorkspaceSplit = useAppStore((state) =>
    Boolean(findWorkspaceSplitGroup(state.workspaceSplitGroups, worktreeId))
  )
  const partnerId = useAppStore((state) =>
    findWorkspaceSplitPartner(state.workspaceSplitGroups, worktreeId)
  )
  const unsplit = () => {
    if (!partnerId) {
      return
    }
    if (activateAndRevealWorkspace(partnerId, { revealInSidebar: false }) !== false) {
      useAppStore.getState().unsplitWorkspace(worktreeId)
    }
  }
  const closeWorkspace = async () => {
    let cancelClicked = false
    const shouldMarkDone = await confirm({
      title: translate(
        'auto.components.workspaceSplit.WorkspacePaneCloseButton.confirmMarkChatsDone',
        'Mark all chats in this workspace as Done?'
      ),
      description: translate(
        'auto.components.workspaceSplit.WorkspacePaneCloseButton.workspaceRemovedDescription',
        'The workspace will be removed from this window.'
      ),
      confirmLabel: translate(
        'auto.components.workspaceSplit.WorkspacePaneCloseButton.confirmYes',
        'Yes'
      ),
      cancelLabel: translate(
        'auto.components.workspaceSplit.WorkspacePaneCloseButton.confirmNo',
        'No'
      ),
      cancelVariant: 'ghost',
      confirmVariant: 'destructive',
      showCloseButton: isWorkspaceSplit,
      onCancelClicked: () => {
        cancelClicked = true
      }
    })
    if (shouldMarkDone) {
      const result = await useAppStore
        .getState()
        .updateWorktreeMeta(worktreeId, { workspaceStatus: 'completed' })
      if (!result.ok) {
        return
      }
      await setWorkspaceChatsCompleted(worktreeId, true)
      if (partnerId) {
        unsplit()
      } else {
        useAppStore.getState().setActiveWorktree(null)
      }
      return
    }
    if (cancelClicked) {
      if (partnerId) {
        unsplit()
      } else {
        useAppStore.getState().setActiveWorktree(null)
      }
    } else if (isWorkspaceSplit) {
      // The dialog's titlebar X removes a split pane without marking its chats Done.
      unsplit()
    }
  }
  const label = 'Close workspace'
  if (menuItem) {
    return <DropdownMenuItem onSelect={closeWorkspace}>{label}</DropdownMenuItem>
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={label}
          data-workspace-unsplit-button={worktreeId}
          onClick={(event) => {
            event.stopPropagation()
            void closeWorkspace()
          }}
        >
          <X className="size-3.5" aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
