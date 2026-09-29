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
  subTab = false,
  lastSubTab = true,
  showFolder = true,
  groupId,
  splitId,
  splitStart,
  splitEnd,
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
  subTab?: boolean
  lastSubTab?: boolean
  showFolder?: boolean
  groupId?: string
  splitId?: string
  splitStart?: boolean
  splitEnd?: boolean
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
          aria-label={`${row.title}, ${row.folder}${splitId ? ', shares a split window' : ''}`}
          tabIndex={tabStop ? 0 : -1}
          data-current={selected ? 'true' : undefined}
          data-chat-sidebar-id={row.id}
          data-worktree-id={row.worktree.id}
          data-chat-completed={row.completed}
          data-chat-state={row.state}
          data-chat-workspace-group={groupId}
          data-chat-split-group={splitId}
          data-chat-sub-tab={subTab ? 'true' : undefined}
          className={cn(
            'relative flex min-w-0 items-start gap-1 rounded-md px-1 py-1 hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
            showFolder ? 'h-11' : 'h-7',
            subTab ? (splitId ? 'pl-9' : 'pl-7') : splitId && 'pl-3',
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
          {splitId ? (
            <span
              aria-hidden="true"
              data-chat-split-bracket=""
              className={cn(
                'pointer-events-none absolute bottom-0 left-0 top-0 w-2 border-l border-muted-foreground',
                splitStart && 'top-3.5 border-t',
                splitEnd && 'bottom-auto h-3.5 border-b'
              )}
            />
          ) : null}
          {subTab ? (
            <span
              aria-hidden="true"
              className={cn(
                'pointer-events-none absolute bottom-0 top-0 w-3',
                splitId ? 'left-7' : 'left-5'
              )}
            >
              <span
                className={cn(
                  'absolute left-0 top-0 border-l border-sidebar-border',
                  lastSubTab ? 'h-3.5' : 'h-full'
                )}
              />
              <span className="absolute left-0 top-3.5 w-2 border-t border-sidebar-border" />
            </span>
          ) : null}
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
            <div className="flex min-w-0 items-center gap-1 leading-5">
              <span
                className={cn('min-w-0 flex-1 truncate', subTab ? 'text-[11px]' : 'text-xs')}
                title={row.title}
              >
                {row.title}
              </span>
              <span
                className="shrink-0 text-[11px] tabular-nums text-muted-foreground"
                title={row.timestamp ? new Date(row.timestamp).toLocaleString() : undefined}
              >
                {row.state === 'working'
                  ? 'Now'
                  : row.timestamp
                    ? formatShortTimeAgo(row.timestamp, now)
                    : ''}
              </span>
            </div>
            {showFolder ? (
              <div className="flex min-w-0 items-center gap-2 text-[11px] leading-4 text-muted-foreground">
                <span
                  className="min-w-0 flex-1 truncate"
                  title={(row.folderWorktree ?? row.worktree).path}
                >
                  {row.folder}
                </span>
              </div>
            ) : null}
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
