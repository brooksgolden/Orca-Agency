import { expect, it, vi } from 'vitest'
import { getDefaultPersistedState } from '../../../shared/constants'
import { updateSettings, type SettingsMutationOperations } from './settings-update'

it('keeps host-recorded automation origins when an older renderer changes chat preferences', () => {
  const operations: SettingsMutationOperations = {
    state: getDefaultPersistedState('/home/test'),
    bumpLocalWorktreeScanGeneration: vi.fn(),
    removeRetainedBlob: vi.fn(),
    scheduleSave: vi.fn(),
    notifySettingsChanged: vi.fn()
  }
  updateSettings(operations, { chatSidebar: { view: 'chats', automationChats: ['run-session'] } })
  const settings = updateSettings(operations, {
    chatSidebar: { view: 'chats', hiddenFolders: ['Local tools'] }
  })
  expect(settings.chatSidebar).toEqual({
    view: 'chats',
    hiddenFolders: ['Local tools'],
    automationChats: ['run-session']
  })
})
