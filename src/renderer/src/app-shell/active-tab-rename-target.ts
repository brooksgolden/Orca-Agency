import type { AppState } from '@/store/types'
import { useAppStore } from '../store'

export function resolveActiveTabRenameTarget(
  activeWorktreeId: string | null,
  store: Pick<AppState, 'activeTabId' | 'activeTabType' | 'getActiveTab'>
): string | null {
  if (store.activeTabType === 'terminal') {
    return store.activeTabId
  }
  if (store.activeTabType !== 'agent-session' || !activeWorktreeId) {
    return null
  }
  const activeTab = store.getActiveTab(activeWorktreeId)
  return activeTab?.contentType === 'agent-session' ? activeTab.id : null
}

// Agency: terminal and structured chat tabs expose different active IDs.
export function resolveRenameTargetTabId(activeWorktreeId: string | null): string | null {
  return resolveActiveTabRenameTarget(activeWorktreeId, useAppStore.getState())
}
