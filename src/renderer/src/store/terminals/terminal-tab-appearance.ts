import { scheduleRuntimeGraphSync } from '@/runtime/sync-runtime-graph'
import { resolveTerminalWorktreeRoute } from '@/lib/terminal-worktree-route'
import type { TerminalSlice, TerminalStoreGet, TerminalStoreSet } from './terminal-state'
import { findRenamableUnifiedTab } from './renamable-unified-tab'
import { captureStructuredChatRename } from '@/runtime/structured-chat-rename-action'
import { updateChatSidebarSettings } from '@/lib/chat-sidebar-settings-update'
import { chatSidebarTabRename } from '@/components/sidebar/chat-sidebar-tab-rename'

export function createTerminalTabAppearanceActions(
  set: TerminalStoreSet,
  get: TerminalStoreGet
): Pick<TerminalSlice, 'setTabCustomTitle' | 'setTabColor'> {
  return {
    setTabCustomTitle: (tabId, title, opts) => {
      const applyTitle = () => {
        // Why: a remote server's tab is named on that server, which republishes the name back here.
        const state = get()
        void import('@/runtime/web-runtime-terminal-rename').then(({ renameHostTerminalTab }) =>
          renameHostTerminalTab(state, tabId, title)
        )
        set((s) => {
          const next = { ...s.tabsByWorktree }
          for (const wId of Object.keys(next)) {
            next[wId] = next[wId].map((t) =>
              t.id === tabId ? { ...t, customTitle: title, sidebarTitleId: opts?.sidebarTitleId } : t
            )
          }
          scheduleRuntimeGraphSync()
          return { tabsByWorktree: next }
        })
        const item = findRenamableUnifiedTab(get().unifiedTabsByWorktree, tabId)
        if (item?.contentType === 'agent-session') {
          const action = captureStructuredChatRename(get, item)
          void import('@/runtime/structured-chat-rename')
            .then(({ renameStructuredChatTab }) =>
              renameStructuredChatTab(
                get,
                item,
                title,
                opts,
                () => get().setTabCustomLabel(item.id, title, opts),
                action
              )
            )
            .finally(action.finish)
        } else if (item) {
          get().setTabCustomLabel(item.id, title, opts)
        }
      }
      // Why: a rename of the sole saved sidebar conversation also updates its saved name before the tab changes.
      const state = get()
      if (
        opts?.syncSidebarTitle !== false &&
        state.settings?.chatSidebar?.titles &&
        chatSidebarTabRename(state, tabId, title, state.settings.chatSidebar)
      ) {
        // Why: clearing a title must clear its saved name before restore can fill the tab again.
        void updateChatSidebarSettings(get, (current) =>
          chatSidebarTabRename(get(), tabId, title, current)
        )
          .then(applyTitle)
          .catch((error) => {
            applyTitle()
            console.debug('[chat-sidebar] tab rename could not be saved', error)
          })
      } else {
        applyTitle()
      }
    },
    setTabColor: (tabId, color, opts) => {
      set((s) => {
        const next = { ...s.tabsByWorktree }
        for (const wId of Object.keys(next)) {
          next[wId] = next[wId].map((t) => (t.id === tabId ? { ...t, color } : t))
        }
        return { tabsByWorktree: next }
      })
      const item = findRenamableUnifiedTab(get().unifiedTabsByWorktree, tabId)
      if (item) {
        get().setUnifiedTabColor(item.id, color, opts)
        // Why: tab color is host-authoritative for remote-server tabs; mirror it so it persists instead of reverting on the next snapshot.
        const state = get()
        const owningWorktreeId = Object.keys(state.unifiedTabsByWorktree).find((wId) =>
          (state.unifiedTabsByWorktree[wId] ?? []).some((entry) => entry.id === item.id)
        )
        if (
          owningWorktreeId &&
          resolveTerminalWorktreeRoute(state, owningWorktreeId)?.runtimeEnvironmentId
        ) {
          void import('@/runtime/web-runtime-terminal-actions').then(({ setWebRuntimeTabProps }) =>
            setWebRuntimeTabProps({ worktreeId: owningWorktreeId, tabId: item.id, color })
          )
        }
      }
    }
  }
}
