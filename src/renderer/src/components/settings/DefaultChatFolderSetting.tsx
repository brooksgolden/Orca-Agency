import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '@/store'
import { ChatFolderPicker } from '../sidebar/ChatFolderPicker'
import { chatFolderKey, defaultChatFolder } from '../sidebar/chat-creation-folders'
import {
  chatFolderHeadingLabels,
  chatFolderPickerGroups,
  isUnregisteredChatFolder,
  registerChatFolderGroup
} from '../sidebar/chat-folder-destinations'
import { selectChatSidebarState } from '../sidebar/use-chat-sidebar-data'
import type { ProjectGroup } from '../../../../shared/project-group-types'
import { updateChatSidebar } from '../sidebar/chat-sidebar-preferences'
import { getNewWorkspaceProjectGroupHostId } from '@/lib/new-workspace-project-options'
import { SearchableSetting } from './SearchableSetting'
import { SettingsRow } from './SettingsFormControls'

export function DefaultChatFolderSetting() {
  const sidebarState = useAppStore(useShallow(selectChatSidebarState))
  const { projectGroups: groups, repos, worktreesByRepo, folderWorkspaces } = sidebarState
  const preference = useAppStore((s) => s.settings?.chatSidebar?.defaultFolder)
  const folders = useMemo(
    () =>
      chatFolderPickerGroups(
        { projectGroups: groups, repos, worktreesByRepo, folderWorkspaces },
        { headingLabels: chatFolderHeadingLabels(sidebarState) }
      ),
    [sidebarState, groups, repos, worktreesByRepo, folderWorkspaces]
  )
  const selected = defaultChatFolder(folders, preference)
  return (
    <div id="general-default-chat-folder" data-settings-section="general-default-chat-folder">
      <SearchableSetting
        title="Default chat folder"
        description="Folder selected when you start a new chat."
        keywords={['chat', 'folder', 'default', 'uncategorized']}
      >
        <SettingsRow
          label="Default chat folder"
          description="New chats start here unless you choose another folder."
          alignTop
          control={
            <div className="w-64">
              <ChatFolderPicker
                folders={folders}
                value={selected ? chatFolderKey(selected) : undefined}
                defaultId={selected ? chatFolderKey(selected) : undefined}
                label="Default chat folder"
                onChange={(id) => {
                  const folder = folders.find((item) => chatFolderKey(item) === id)
                  if (folder) {
                    const save = (group: ProjectGroup) =>
                      updateChatSidebar({
                        defaultFolder: {
                          projectGroupId: group.id,
                          executionHostId: getNewWorkspaceProjectGroupHostId(group)
                        }
                      })
                    void (isUnregisteredChatFolder(folder)
                      ? registerChatFolderGroup(folder).then((group) => group && save(group))
                      : save(folder))
                  }
                }}
              />
            </div>
          }
        />
      </SearchableSetting>
    </div>
  )
}
