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
import { translate } from '@/i18n/i18n'
import {
  hasAnyCheck,
  legacyDoneFlag,
  resolveCollapseFolders,
  resolveHideChats,
  type ResolvedChatStateChecks
} from './chat-sidebar-chat-filters'

const CHAT_STATE_OPTIONS: { key: keyof ResolvedChatStateChecks; label: string }[] = [
  {
    key: 'doneClosed',
    label: translate('auto.components.sidebar.ChatSidebarOptions.doneClosed', 'Done Closed')
  },
  {
    key: 'doneOpen',
    label: translate('auto.components.sidebar.ChatSidebarOptions.doneOpen', 'Done Open')
  },
  { key: 'idle', label: translate('auto.components.sidebar.ChatSidebarOptions.idle', 'Idle') }
]

export function ChatSidebarOptions() {
  const groupBy = useAppStore((state) => state.settings?.chatSidebar?.groupBy ?? 'status')
  const chatSidebar = useAppStore((state) => state.settings?.chatSidebar)
  const hide = resolveHideChats(chatSidebar)
  const collapse = resolveCollapseFolders(chatSidebar)
  const showOnlyOpenChats = useAppStore(
    (state) => state.settings?.chatSidebar?.showOnlyOpenChats ?? false
  )
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
  const hasActiveFilters = hasAnyCheck(hide) || hasAnyCheck(collapse) || showOnlyOpenChats
  const label = `Chat grouping and folder filters${hasActiveFilters ? ', filters active' : ''}${hiddenCount ? ` (${hiddenCount} hidden)` : ''}`
  return (
    <DropdownMenu modal={false}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant={hasActiveFilters ? 'outline' : 'ghost'}
              size="icon-xs"
              aria-label={label}
              data-filters-active={hasActiveFilters}
              className="relative"
            >
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
          <DropdownMenuSubTrigger>
            {translate('auto.components.sidebar.ChatSidebarOptions.hideChats', 'Hide Chats')}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {CHAT_STATE_OPTIONS.map(({ key, label }) => (
              <DropdownMenuCheckboxItem
                key={key}
                checked={hide[key]}
                onSelect={(event) => event.preventDefault()}
                onCheckedChange={(checked) =>
                  void updateChatSidebar((current) => {
                    const next = { ...resolveHideChats(current), [key]: checked === true }
                    // Why: the legacy Done flag stays in step so a rollback to 1069 hides no more than chosen.
                    return { hideChats: next, showOnlyInProgress: legacyDoneFlag(next) }
                  })
                }
              >
                {label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuCheckboxItem
          className="pl-2.5 pr-8 [&>span:first-child]:left-auto [&>span:first-child]:right-2.5"
          checked={showOnlyOpenChats}
          onSelect={(event) => event.preventDefault()}
          onCheckedChange={(checked) =>
            void updateChatSidebar({ showOnlyOpenChats: checked === true })
          }
        >
          {translate(
            'auto.components.sidebar.ChatSidebarOptions.showOnlyOpenChats',
            'Show only open chats'
          )}
        </DropdownMenuCheckboxItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            {translate(
              'auto.components.sidebar.ChatSidebarOptions.collapseFolders',
              'Collapse Folders'
            )}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {CHAT_STATE_OPTIONS.map(({ key, label }) => (
              <DropdownMenuCheckboxItem
                key={key}
                checked={collapse[key]}
                onSelect={(event) => event.preventDefault()}
                onCheckedChange={(checked) =>
                  void updateChatSidebar((current) => {
                    const next = { ...resolveCollapseFolders(current), [key]: checked === true }
                    return {
                      collapseFolders: next,
                      collapseDoneFolders: legacyDoneFlag(next),
                      expandedDoneFolders: []
                    }
                  })
                }
              >
                {label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
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
