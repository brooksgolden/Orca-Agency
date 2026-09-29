import { SlidersHorizontal } from 'lucide-react'
import { useAppStore } from '@/store'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { updateChatSidebar } from './chat-sidebar-preferences'

export function ChatSidebarOptions() {
  const groupBy = useAppStore((state) => state.settings?.chatSidebar?.groupBy ?? 'status')
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label="Chat list options">
          <SlidersHorizontal className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
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
        <DropdownMenuItem onSelect={() => void updateChatSidebar({ view: 'workspaces' })}>
          Manage workspaces and folders
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
