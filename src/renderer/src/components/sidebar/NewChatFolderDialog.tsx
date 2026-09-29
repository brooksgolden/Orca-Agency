import { useCallback, useState } from 'react'
import { useAppStore } from '@/store'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { parseExecutionHostId } from '../../../../shared/execution-host'
import type { Worktree } from '../../../../shared/worktree/types'
import type { ChatSidebarRow } from './chat-sidebar-types'
import { useCreateRepo } from './useCreateRepo'
import { CreateProjectParentBrowser } from './CreateProjectLocationField'
import { setChatFolder } from './chat-sidebar-preferences'

export function NewChatFolderDialog({
  row,
  onClose
}: {
  row: ChatSidebarRow
  onClose: () => void
}) {
  const host = parseExecutionHostId(row.hostId)
  const fetchWorktrees = useAppStore((state) => state.fetchWorktrees)
  const [browsing, setBrowsing] = useState(false)
  const onFolderReady = useCallback((worktree: Worktree) => setChatFolder(row, worktree), [row])
  const create = useCreateRepo(fetchWorktrees, onClose, undefined, {
    hostId: row.hostId,
    runtimeEnvironmentId: host?.kind === 'runtime' ? host.environmentId : null,
    sshTargetId: host?.kind === 'ssh' ? host.targetId : null,
    kind: 'folder',
    onFolderReady
  })
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !create.isCreating) {
          onClose()
        }
      }}
    >
      <DialogContent>
        {browsing ? (
          <CreateProjectParentBrowser
            runtimeEnvironmentId={host?.kind === 'runtime' ? host.environmentId : null}
            sshTargetId={host?.kind === 'ssh' ? host.targetId : null}
            createParent={create.createParent}
            onParentChange={create.setCreateParent}
            onClose={() => setBrowsing(false)}
          />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>New folder</DialogTitle>
              <DialogDescription>
                Create a folder for this chat. Running work will continue; the new location applies
                when you reopen the chat.
              </DialogDescription>
            </DialogHeader>
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault()
                void create.handleCreate()
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="chat-folder-name">Folder name</Label>
                <Input
                  id="chat-folder-name"
                  value={create.createName}
                  disabled={create.isCreating}
                  onChange={(event) => create.setCreateName(event.target.value)}
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="chat-folder-parent">Create inside</Label>
                <div className="flex gap-2">
                  <Input
                    id="chat-folder-parent"
                    value={create.createParent}
                    disabled={create.isCreating}
                    onChange={(event) => create.setCreateParent(event.target.value)}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={create.isCreating}
                    onClick={() =>
                      host?.kind === 'local' ? void create.handlePickParent() : setBrowsing(true)
                    }
                  >
                    Browse
                  </Button>
                </div>
              </div>
              {create.createError ? (
                <p role="alert" className="text-sm text-destructive">
                  {create.createError}
                </p>
              ) : null}
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  disabled={create.isCreating}
                  onClick={onClose}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={
                    create.isCreating || !create.createName.trim() || !create.createParent.trim()
                  }
                >
                  {create.isCreating ? 'Creating...' : 'Create folder'}
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
