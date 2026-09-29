import { useAppStore } from '@/store'
import { updateChatSidebar } from '@/components/sidebar/chat-sidebar-preferences'
import { chatFallbackId, chatSessionKey } from '@/components/sidebar/chat-sidebar-types'
import {
  getSettingsFocusedExecutionHostId,
  getWorktreeExecutionHostId
} from '../../../shared/execution-host'
import type { AgentStatusEntry } from '../../../shared/agent-status-types'

/** Records exact ownership, never a title or the whole workspace. */
export function registerAutomationChat(
  worktreeId: string,
  identities: {
    tabId?: string
    paneKey?: string
    status?: Pick<AgentStatusEntry, 'providerSession' | 'agentType'>
  }
) {
  const state = useAppStore.getState()
  const worktree = state.getKnownWorktreeById(worktreeId)
  if (!worktree) {
    return Promise.resolve()
  }
  const hostId = getWorktreeExecutionHostId(
    worktree,
    state.repos.find((repo) => repo.id === worktree.repoId),
    getSettingsFocusedExecutionHostId(state.settings)
  )
  const ids = [identities.tabId, identities.paneKey].flatMap((id) =>
    id ? [chatFallbackId(hostId, id)] : []
  )
  const provider = identities.status?.providerSession
  if (provider && identities.status?.agentType) {
    ids.push(chatSessionKey(hostId, identities.status.agentType, provider.id))
  }
  return updateChatSidebar((current) => {
    const known = new Set(current.automationChats ?? [])
    if (ids.every((id) => known.has(id))) {
      return null
    }
    return { automationChats: [...new Set([...known, ...ids])] }
  })
}
