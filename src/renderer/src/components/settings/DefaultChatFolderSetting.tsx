import { useMemo } from 'react'
import { useAppStore } from '@/store'
import { ChatFolderPicker } from '../sidebar/ChatFolderPicker'
import {
  chatCreationFolders,
  chatFolderKey,
  defaultChatFolder
} from '../sidebar/chat-creation-folders'
import { updateChatSidebar } from '../sidebar/chat-sidebar-preferences'
import { getNewWorkspaceProjectGroupHostId } from '@/lib/new-workspace-project-options'
import { SearchableSetting } from './SearchableSetting'
import { SettingsRow } from './SettingsFormControls'

export function DefaultChatFolderSetting() {
  const groups = useAppStore((s) => s.projectGroups)
  const preference = useAppStore((s) => s.settings?.chatSidebar?.defaultFolder)
  const folders = useMemo(() => chatCreationFolders(groups), [groups])
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
                    void updateChatSidebar({
                      defaultFolder: {
                        projectGroupId: folder.id,
                        executionHostId: getNewWorkspaceProjectGroupHostId(folder)
                      }
                    })
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
