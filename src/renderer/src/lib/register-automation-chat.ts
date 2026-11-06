import { useAppStore } from '@/store'
import { updateChatSidebar } from '@/components/sidebar/chat-sidebar-preferences'
import { chatFallbackId, chatSessionKey } from '@/components/sidebar/chat-sidebar-types'
import {
  getSettingsFocusedExecutionHostId,
  getWorktreeExecutionHostId
} from '../../../shared/execution-host'
import type { AgentStatusEntry } from '../../../shared/agent-status-types'

type ChatIdentities = {
  tabId?: string
  paneKey?: string
  status?: Pick<AgentStatusEntry, 'providerSession' | 'agentType'>
}

/** Exact tab, pane and provider identities for a chat; never a title or the whole workspace. */
function chatIdentityIds(worktreeId: string, identities: ChatIdentities): string[] | null {
  const state = useAppStore.getState()
  const worktree = state.getKnownWorktreeById(worktreeId)
  if (!worktree) {
    return null
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
  return ids
}

/** Records exact ownership of an agent- or automation-started chat. */
export function registerAutomationChat(worktreeId: string, identities: ChatIdentities) {
  const ids = chatIdentityIds(worktreeId, identities)
  if (!ids) {
    return Promise.resolve()
  }
  return updateChatSidebar((current) => {
    const known = new Set(current.automationChats ?? [])
    if (ids.every((id) => known.has(id))) {
      return null
    }
    return { automationChats: [...new Set([...known, ...ids])] }
  })
}

/** A person submitted a message here: the chat is kept in the sidebar after its tab closes. */
export function recordHumanChatMessage(worktreeId: string, identities: ChatIdentities) {
  const ids = chatIdentityIds(worktreeId, identities)
  if (!ids) {
    return Promise.resolve()
  }
  return updateChatSidebar((current) => {
    const known = new Set(current.humanChats ?? [])
    if (ids.every((id) => known.has(id))) {
      return null
    }
    return { humanChats: [...new Set([...known, ...ids])] }
  })
}
