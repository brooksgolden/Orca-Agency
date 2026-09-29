import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { SlidersHorizontal } from 'lucide-react'
import { useAppStore } from '@/store'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { updateChatSidebar } from './chat-sidebar-preferences'
import { chatFolderLabel, chatSidebarWorktrees } from './chat-sidebar-rows'
import { hiddenChatFolderLabels } from './chat-creation-folders'

export function ChatSidebarOptions() {
  const groupBy = useAppStore((state) => state.settings?.chatSidebar?.groupBy ?? 'status')
  const savedHiddenFolders = useAppStore((state) => state.settings?.chatSidebar?.hiddenFolders)
  const state = useAppStore(
    useShallow((s) => ({
      repos: s.repos,
      projectGroups: s.projectGroups,
      folderWorkspaces: s.folderWorkspaces,
      worktreesByRepo: s.worktreesByRepo
    }))
  )
  const hiddenFolders = hiddenChatFolderLabels(savedHiddenFolders, state.projectGroups)
  const folders = useMemo(
    () =>
      [...new Set(chatSidebarWorktrees(state).map((row) => chatFolderLabel(state, row)))].sort(),
    [state]
  )
  const hiddenCount = folders.filter((folder) => hiddenFolders?.includes(folder)).length
  const label = hiddenCount
    ? `Chat grouping and folder filters (${hiddenCount} hidden)`
    : 'Chat grouping and folder filters'
  return (
    <DropdownMenu modal={false}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-xs" aria-label={label} className="relative">
              <SlidersHorizontal className="size-3.5" />
              {hiddenCount > 0 ? (
                <span
                  aria-hidden
                  className="absolute -top-0.5 -right-0.5 flex h-3 min-w-3 items-center justify-center rounded-full bg-primary px-0.5 text-[9px] font-medium leading-none text-primary-foreground"
                >
                  {hiddenCount > 9 ? '9+' : hiddenCount}
                </span>
              ) : null}
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6}>
          {label}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Group chats</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={groupBy}
          onValueChange={(value) => {
            if (value === 'recent' || value === 'status' || value === 'folder') {
              void updateChatSidebar({ groupBy: value })
            }
          }}
        >
          <DropdownMenuRadioItem value="recent">All chats, newest first</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="status">Status</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="folder">Folder</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Folders</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem onSelect={() => void updateChatSidebar({ hiddenFolders: [] })}>
              Show all folders
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {folders.map((folder) => (
              <DropdownMenuCheckboxItem
                key={folder}
                checked={!hiddenFolders?.includes(folder)}
                onSelect={(event) => event.preventDefault()}
                onCheckedChange={(checked) => {
                  void updateChatSidebar((current) => ({
                    hiddenFolders: checked
                      ? hiddenChatFolderLabels(current.hiddenFolders, state.projectGroups).filter(
                          (item) => item !== folder
                        )
                      : [
                          ...new Set([
                            ...hiddenChatFolderLabels(current.hiddenFolders, state.projectGroups),
                            folder
                          ])
                        ]
                  }))
                }}
              >
                {folder}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void updateChatSidebar({ view: 'workspaces' })}>
          Manage workspaces and folders
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
