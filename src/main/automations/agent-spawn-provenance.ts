import type { Store } from '../persistence'
import type { AgentHookProviderSessionIdentity } from '../agent-hooks/server'
import { agentHookServer } from '../agent-hooks/server'
import { createHumanSubmitTracker } from '../../shared/human-submit-signal'

// Why: keys match the renderer's chatFallbackId and chatSessionKey, so the sidebar's existing
// identity checks see these chats without a second mechanism.
function fallbackKey(hostId: string, tabOrPaneKey: string): string {
  return JSON.stringify([hostId, tabOrPaneKey])
}

function sessionKey(hostId: string, agent: string, sessionId: string): string {
  return JSON.stringify([hostId, agent, sessionId])
}

// Why: a provider session id is unique, so recording a key for an agent a pane never ran matches nothing.
const SPAWNABLE_AGENTS = ['claude', 'codex'] as const

type SettingsStore = Pick<Store, 'getSettings' | 'updateSettings'>

let boundStore: SettingsStore | null = null
/** Pane key to host for panes an agent spawned; their provider session is recorded when it appears. */
const agentSpawnedPanes = new Map<string, string>()
const humanSubmitTrackers = new Map<string, ReturnType<typeof createHumanSubmitTracker>>()

export function bindAgentSpawnProvenance(store: SettingsStore): void {
  boundStore = store
  // Why: panes spawned before a restart still need their provider session recorded once the hook reports it.
  for (const [paneKey, hostId] of Object.entries(
    store.getSettings().chatSidebar?.agentSpawnedPanes ?? {}
  )) {
    agentSpawnedPanes.set(paneKey, hostId)
  }
}

function persistSpawnedPane(paneKey: string, hostId: string): void {
  if (!boundStore || agentSpawnedPanes.get(paneKey) === hostId) {
    return
  }
  const sidebar = boundStore.getSettings().chatSidebar ?? {}
  boundStore.updateSettings(
    {
      chatSidebar: {
        ...sidebar,
        agentSpawnedPanes: { ...sidebar.agentSpawnedPanes, [paneKey]: hostId }
      }
    },
    { notifyListeners: true }
  )
}

function writeChatIds(field: 'automationChats' | 'humanChats', ids: readonly string[]): void {
  if (!boundStore || ids.length === 0) {
    return
  }
  const sidebar = boundStore.getSettings().chatSidebar ?? {}
  const existing = new Set(sidebar[field] ?? [])
  if (ids.every((id) => existing.has(id))) {
    return
  }
  boundStore.updateSettings(
    { chatSidebar: { ...sidebar, [field]: [...new Set([...existing, ...ids])] } },
    { notifyListeners: true }
  )
}

export type ChatSpot = {
  hostId: string
  tabId?: string | null
  paneKey?: string | null
}

/** An agent (CLI, orchestration dispatch) started this chat. It stays hidden once its tab closes. */
export function recordAgentSpawnedChat(spot: ChatSpot): void {
  const ids = [spot.tabId, spot.paneKey].flatMap((id) => (id ? [fallbackKey(spot.hostId, id)] : []))
  writeChatIds('automationChats', ids)
  if (spot.paneKey) {
    persistSpawnedPane(spot.paneKey, spot.hostId)
    agentSpawnedPanes.set(spot.paneKey, spot.hostId)
  }
}

/** Once a spawned pane's provider session is known, its session identity is recorded too. */
export function recordAgentSpawnedProviderSessions(
  providers: readonly AgentHookProviderSessionIdentity[]
): void {
  const ids: string[] = []
  for (const provider of providers) {
    const hostId = agentSpawnedPanes.get(provider.paneKey)
    if (!hostId) {
      continue
    }
    for (const agent of SPAWNABLE_AGENTS) {
      ids.push(sessionKey(hostId, agent, provider.sessionId))
    }
  }
  writeChatIds('automationChats', ids)
}

/** A person submitted text from a human-driven UI (mobile composer). The chat stays visible afterwards. */
export function recordHumanSubmit(spot: ChatSpot, typed: string): void {
  let tracker = humanSubmitTrackers.get(spot.paneKey ?? spot.hostId)
  if (!tracker) {
    tracker = createHumanSubmitTracker()
    humanSubmitTrackers.set(spot.paneKey ?? spot.hostId, tracker)
  }
  if (!tracker.observe(typed, true)) {
    return
  }
  const ids = [spot.tabId, spot.paneKey].flatMap((id) => (id ? [fallbackKey(spot.hostId, id)] : []))
  const providers = agentHookServer
    .getProviderSessionIdentities()
    .filter((provider) => provider.paneKey === spot.paneKey)
  for (const provider of providers) {
    for (const agent of SPAWNABLE_AGENTS) {
      ids.push(sessionKey(spot.hostId, agent, provider.sessionId))
    }
  }
  writeChatIds('humanChats', ids)
}

/** Whether a live agent provider is attached to this pane. A plain shell pane has none. */
export function isAgentPane(paneKey: string): boolean {
  return agentHookServer.getProviderSessionIdentities().some((p) => p.paneKey === paneKey)
}
