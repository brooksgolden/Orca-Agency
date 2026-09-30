import { useCallback, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useShallow } from 'zustand/react/shallow'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter
} from '@/components/ui/dialog'
import { useNow } from '@/hooks/use-now'
import { activateAndRevealWorkspace } from '@/lib/worktree-activation'
import { activateTabAndFocusPane } from '@/lib/activate-tab-and-focus-pane'
import { activateStructuredAgentSessionTab } from '@/lib/structured-agent-session-tab-activation'
import { parsePaneKey } from '../../../../shared/stable-pane-id'
import { useAiVaultSessionLaunchActions } from '../right-sidebar/ai-vault-session-launch-actions'
import { ChatSidebarRow } from './ChatSidebarRow'
import type { ChatSidebarRow as Row } from './chat-sidebar-types'
import { useChatSidebarData } from './use-chat-sidebar-data'
import { setChatSidebarTitle, setChatCompleted } from './chat-sidebar-preferences'
import { activeChatTarget, isChatRowSelected } from './chat-sidebar-selection'
import { chatResumeSession } from './chat-sidebar-resume'
import { NewChatFolderDialog } from './NewChatFolderDialog'
import { chatSidebarListItems, chatSidebarItemHeight } from './chat-sidebar-groups'
import {
  chatFolderDestinations,
  changeChatFolder,
  type ChatFolderDestination
} from './chat-folder-destinations'

const NAVIGATION_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Home', 'End'])

export default function SidebarChatList({ onOpen }: { onOpen?: () => void }) {
  const { rows, state, history } = useChatSidebarData()
  const splits = useAppStore((s) => s.workspaceSplitGroups)
  const now = useNow(30_000)
  const [query, setQuery] = useState('')
  const [renaming, setRenaming] = useState<Row | null>(null)
  const [name, setName] = useState('')
  const [newFolderRow, setNewFolderRow] = useState<Row | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const target = useAppStore(useShallow(activeChatTarget))
  const targetState = useAppStore(
    useShallow((s) => ({
      worktreesByRepo: s.worktreesByRepo,
      repos: s.repos,
      projectGroups: s.projectGroups,
      folderWorkspaces: s.folderWorkspaces
    }))
  )
  const { handleResume } = useAiVaultSessionLaunchActions({
    activeWorktree: null,
    activeWorktreeId: null,
    targetState
  })
  const folders = useMemo(() => chatFolderDestinations(targetState), [targetState])
  const moveChat = useCallback((row: Row, folder: ChatFolderDestination) => {
    void changeChatFolder(row, folder)
      .then(() => {
        toast.success(`${row.tabId ? 'Workspace' : 'Chat'} filed under ${folder.label}`, {
          description: row.tabId
            ? 'Running work continues. The new working folder applies when you reopen the chat.'
            : undefined
        })
      })
      .catch((error: unknown) =>
        toast.error(error instanceof Error ? error.message : 'Could not change folder.')
      )
  }, [])
  const openChat = useCallback(
    (row: Row) => {
      const resumeSession = row.tabId ? null : chatResumeSession(row)
      if (resumeSession) {
        // Why: persist the legacy Done default before a resume makes the row resident.
        void (row.completed ? setChatCompleted(row, true) : Promise.resolve())
          .then(() => {
            handleResume(resumeSession, (row.folderWorktree ?? row.worktree).id)
            onOpen?.()
          })
          .catch(() => toast.error('Could not save the chat status before reopening.'))
        return
      }
      if (
        activateAndRevealWorkspace(row.worktree.id, {
          executionHostId: row.hostId,
          revealInSidebar: false
        }) === false
      ) {
        return
      }
      if (row.tabId) {
        if (!activateStructuredAgentSessionTab({ worktreeId: row.worktree.id, tabId: row.tabId })) {
          activateTabAndFocusPane(
            row.tabId,
            row.paneKey ? (parsePaneKey(row.paneKey)?.leafId ?? null) : null
          )
        }
      }
      onOpen?.()
    },
    [handleResume, onOpen]
  )
  const renameChat = useCallback((row: Row) => {
    setRenaming(row)
    setName(row.title)
  }, [])
  const items = useMemo(
    () => chatSidebarListItems(rows, state, query, splits),
    [rows, state, query, splits]
  )
  const chatsByTab = useMemo(() => {
    const counts = new Map<string, number>()
    for (const row of rows) {
      if (row.tabId) {
        counts.set(row.tabId, (counts.get(row.tabId) ?? 0) + 1)
      }
    }
    return counts
  }, [rows])
  const selectedId = useMemo(
    () =>
      rows.find((row) => isChatRowSelected(row, target, chatsByTab.get(row.tabId ?? '') ?? 0))
        ?.id ?? null,
    [rows, target, chatsByTab]
  )
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => chatSidebarItemHeight(items[index]),
    getItemKey: (index) => items[index].id,
    overscan: 8
  })
  const virtualItems = virtualizer.getVirtualItems()
  const renderedChatIds = virtualItems.flatMap((item) =>
    items[item.index]?.kind === 'chat' ? [items[item.index].id] : []
  )
  // Why: one tab stop keeps Tab from walking every chat; arrows move within the list.
  const tabStopId =
    selectedId && renderedChatIds.includes(selectedId) ? selectedId : renderedChatIds[0]
  const moveFocus = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!NAVIGATION_KEYS.has(event.key) || !(event.target instanceof HTMLElement)) {
      return
    }
    const currentId =
      event.target.closest<HTMLElement>('[data-chat-sidebar-id]')?.dataset.chatSidebarId
    const chatIndexes = items.flatMap((item, index) => (item.kind === 'chat' ? [index] : []))
    const position = chatIndexes.findIndex((index) => items[index].id === currentId)
    if (position === -1 || chatIndexes.length === 0) {
      return
    }
    event.preventDefault()
    const nextPosition =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? chatIndexes.length - 1
          : Math.min(
              chatIndexes.length - 1,
              Math.max(0, position + (event.key === 'ArrowDown' ? 1 : -1))
            )
    const nextIndex = chatIndexes[nextPosition]
    virtualizer.scrollToIndex(nextIndex)
    requestAnimationFrame(() => {
      scrollRef.current
        ?.querySelector<HTMLElement>(`[data-chat-sidebar-id="${CSS.escape(items[nextIndex].id)}"]`)
        ?.focus()
    })
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-chat-sidebar="">
      <div className="flex shrink-0 flex-col gap-1 px-2 pb-1">
        <Input
          aria-label="Find chat"
          placeholder="Find chat..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      {history.error ? (
        <div className="px-3 text-xs text-muted-foreground">
          Earlier chats could not load.{' '}
          <Button variant="link" size="xs" onClick={() => void history.refresh()}>
            Retry
          </Button>
        </div>
      ) : null}
      {history.loading && rows.length === 0 ? (
        <div className="px-3 text-xs text-muted-foreground">Loading chats...</div>
      ) : null}
      <div
        ref={scrollRef}
        role="listbox"
        aria-label="Chats"
        className="min-h-0 flex-1 overflow-y-auto px-2 worktree-sidebar-scrollbar"
        onKeyDown={moveFocus}
      >
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualItems.map((item) => {
            const entry = items[item.index]
            return (
              <div
                key={item.key}
                data-index={item.index}
                ref={virtualizer.measureElement}
                className="absolute left-0 top-0 w-full"
                style={{ transform: `translateY(${item.start}px)` }}
              >
                {entry.kind === 'heading' ? (
                  <div
                    role="presentation"
                    className="flex h-7 items-center px-1 text-xs font-medium text-muted-foreground"
                  >
                    {entry.label}
                  </div>
                ) : (
                  <ChatSidebarRow
                    row={entry.row}
                    subTab={entry.subTab}
                    showFolder={entry.showFolder}
                    groupId={entry.groupId}
                    splitId={entry.splitId}
                    splitStart={entry.splitStart}
                    splitEnd={entry.splitEnd}
                    now={now}
                    selected={entry.id === selectedId}
                    tabStop={entry.id === tabStopId}
                    onOpen={openChat}
                    onRename={renameChat}
                    folders={folders}
                    onChangeFolder={moveChat}
                    onNewFolder={setNewFolderRow}
                  />
                )}
              </div>
            )
          })}
        </div>
        {!history.loading && items.length === 0 ? (
          <div className="p-2 text-xs text-muted-foreground">
            {rows.length === 0 ? 'No chats yet.' : 'No chats match this view.'}
          </div>
        ) : null}
      </div>
      <Dialog
        open={renaming !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRenaming(null)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename chat</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (renaming) {
                void setChatSidebarTitle(renaming, name)
              }
              setRenaming(null)
            }}
          >
            <Input
              aria-label="Chat name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <DialogFooter className="mt-4">
              <Button type="submit">Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {newFolderRow ? (
        <NewChatFolderDialog row={newFolderRow} onClose={() => setNewFolderRow(null)} />
      ) : null}
    </div>
  )
}
