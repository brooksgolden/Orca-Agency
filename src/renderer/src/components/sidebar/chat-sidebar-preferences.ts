import { useAppStore } from '@/store'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { ChatSidebarRow } from './chat-sidebar-types'

type Preferences = NonNullable<GlobalSettings['chatSidebar']>
let pendingUpdate = Promise.resolve()

export function updateChatSidebar(
  patch: Partial<Preferences> | ((current: Preferences) => Partial<Preferences> | null)
) {
  const update = pendingUpdate.then(async () => {
    const state = useAppStore.getState()
    const current = state.settings?.chatSidebar ?? {}
    const next = typeof patch === 'function' ? patch(current) : patch
    if (next) {
      await state.updateSettings({ chatSidebar: { ...current, ...next } })
    }
  })
  pendingUpdate = update.catch(() => {})
  return update
}

export function setChatCompleted(row: ChatSidebarRow, completed: boolean) {
  return updateChatSidebar((current) => ({
    completed: {
      ...current.completed,
      [row.id]: {
        activityAt: row.timestamp,
        at: Date.now(),
        done: completed,
        ...(row.state === 'working' ? { working: true } : {})
      }
    }
  }))
}

export function setChatSidebarTitle(row: Pick<ChatSidebarRow, 'id' | 'aliases'>, title: string) {
  return updateChatSidebar((current) => {
    const titles = { ...current.titles }
    // Why: a name left under an earlier id would resurface when this one is cleared.
    for (const id of [row.id, ...row.aliases]) {
      delete titles[id]
    }
    if (title.trim()) {
      titles[row.id] = title.trim()
    }
    return { titles }
  })
}
