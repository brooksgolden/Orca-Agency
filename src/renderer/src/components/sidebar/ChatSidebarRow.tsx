import { memo } from 'react'
import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { AgentStateDot } from '@/components/AgentStateDot'
import { formatShortTimeAgo } from '@/lib/short-time-ago'
import { cn } from '@/lib/utils'
import { writeWorkspaceDragData } from './workspace-status'
import type { ChatSidebarRow as Row } from './chat-sidebar-types'
import { setChatCompleted } from './chat-sidebar-preferences'
import { selectChatTabInWorkspace } from './chat-sidebar-selection'
import type { ChatFolderDestination } from './chat-folder-destinations'

export const ChatSidebarRow = memo(function ChatSidebarRow({
  row,
  selected,
  tabStop,
  now,
  onOpen,
  onRename,
  folders,
  onChangeFolder,
  onNewFolder
}: {
  row: Row
  selected: boolean
  tabStop: boolean
  now: number
  onOpen: (row: Row) => void
  onRename: (row: Row) => void
  folders: ChatFolderDestination[]
  onChangeFolder: (row: Row, folder: ChatFolderDestination) => void
  onNewFolder: (row: Row) => void
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="option"
          aria-selected={selected}
          aria-label={`${row.title}, ${row.folder}`}
          tabIndex={tabStop ? 0 : -1}
          data-current={selected ? 'true' : undefined}
          data-chat-sidebar-id={row.id}
          data-worktree-id={row.worktree.id}
          data-chat-completed={row.completed}
          data-chat-state={row.state}
          className={cn(
            'flex h-11 min-w-0 items-center gap-1 rounded-md px-1 hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
            selected && 'bg-sidebar-accent'
          )}
          onClick={() => onOpen(row)}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget) {
              return
            }
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              onOpen(row)
            }
            if (event.key === 'Delete') {
              event.preventDefault()
              void setChatCompleted(row, true)
            }
          }}
          draggable={Boolean(row.tabId)}
          onDragStart={(event) => {
            selectChatTabInWorkspace(row)
            writeWorkspaceDragData(event.dataTransfer, row.worktree.id)
          }}
        >
          <Button
            variant="ghost"
            size="icon-xs"
            // Why: keyboard users toggle via Delete and the context menu; one tab stop per row.
            tabIndex={-1}
            aria-label={row.completed ? `Reopen ${row.title}` : `Mark ${row.title} done`}
            onClick={(event) => {
              event.stopPropagation()
              void setChatCompleted(row, !row.completed)
            }}
          >
            {row.completed ? <Check className="size-3.5" /> : <AgentStateDot state={row.state} />}
          </Button>
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs leading-4" title={row.title}>
              {row.title}
            </div>
            <div className="flex min-w-0 items-center gap-2 text-[11px] leading-4 text-muted-foreground">
              <span
                className="min-w-0 flex-1 truncate"
                title={(row.folderWorktree ?? row.worktree).path}
              >
                {row.folder}
              </span>
              <span
                className="shrink-0 tabular-nums"
                title={row.timestamp ? new Date(row.timestamp).toLocaleString() : undefined}
              >
                {row.state === 'working'
                  ? 'Now'
                  : row.timestamp
                    ? formatShortTimeAgo(row.timestamp, now)
                    : ''}
              </span>
            </div>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => onOpen(row)}>Open chat</ContextMenuItem>
        <ContextMenuItem onSelect={() => onRename(row)}>Rename chat</ContextMenuItem>
        <ContextMenuItem onSelect={() => void setChatCompleted(row, !row.completed)}>
          {row.completed ? 'Move to In progress' : 'Mark done'}
        </ContextMenuItem>
        <ContextMenuSub>
          <ContextMenuSubTrigger>Change folder</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuItem onSelect={() => onNewFolder(row)}>New folder...</ContextMenuItem>
            <ContextMenuSeparator />
            {folders
              .filter((folder) => folder.hostId === row.hostId)
              .map((folder) => (
                <ContextMenuItem key={folder.id} onSelect={() => onChangeFolder(row, folder)}>
                  {folder.label}
                </ContextMenuItem>
              ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
      </ContextMenuContent>
    </ContextMenu>
  )
})
