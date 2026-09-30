import type { ChatSidebarSettings } from '../../../shared/chat-sidebar-settings'
import type { GlobalSettings } from '../../../shared/global-settings-types'

type SettingsOwner = {
  settings: GlobalSettings | null
  updateSettings: (updates: Partial<GlobalSettings>) => Promise<void>
}
let pendingUpdate = Promise.resolve()

/** One queue for UI edits, close events and background session recording. */
export function updateChatSidebarSettings(
  get: () => SettingsOwner,
  patch:
    | Partial<ChatSidebarSettings>
    | ((current: ChatSidebarSettings) => Partial<ChatSidebarSettings> | null)
) {
  const update = pendingUpdate.then(async () => {
    const state = get()
    const current = state.settings?.chatSidebar ?? {}
    const next = typeof patch === 'function' ? patch(current) : patch
    if (next) {
      await state.updateSettings({ chatSidebar: { ...current, ...next } })
    }
  })
  pendingUpdate = update.catch(() => {})
  return update
}
