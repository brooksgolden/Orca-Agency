import type { ProjectGroup } from '../../../../shared/project-group-types'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { getNewWorkspaceProjectGroupHostId } from '@/lib/new-workspace-project-options'
import { useSidebarHostScopeOptions } from './use-sidebar-host-scope-options'
import { chatFolderKey } from './chat-creation-folders'

export function ChatFolderPicker({
  folders,
  value,
  defaultId,
  onChange,
  label = 'Folder'
}: {
  folders: readonly ProjectGroup[]
  value: string | undefined
  defaultId?: string
  onChange: (value: string) => void
  label?: string
}) {
  const { hostOptions } = useSidebarHostScopeOptions()
  const selected = folders.find((folder) => chatFolderKey(folder) === value)
  return (
    <div className="min-w-0 space-y-1">
      <Select value={selected ? chatFolderKey(selected) : ''} onValueChange={onChange}>
        <SelectTrigger aria-label={label} className="w-full">
          <SelectValue placeholder="Choose folder" />
        </SelectTrigger>
        <SelectContent>
          {folders.map((folder) => (
            <SelectItem
              key={chatFolderKey(folder)}
              value={chatFolderKey(folder)}
              title={folder.parentPath ?? undefined}
            >
              {folder.name}
              {chatFolderKey(folder) === defaultId ? ' (default)' : ''}
              {getNewWorkspaceProjectGroupHostId(folder) !== 'local'
                ? ` - ${hostOptions.find((host) => host.id === getNewWorkspaceProjectGroupHostId(folder))?.label ?? 'Remote host'}`
                : ''}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {selected?.parentPath ? (
        <p className="break-all text-xs text-muted-foreground">{selected.parentPath}</p>
      ) : (
        <p className="text-xs text-muted-foreground">Choose an available folder to continue.</p>
      )}
    </div>
  )
}
