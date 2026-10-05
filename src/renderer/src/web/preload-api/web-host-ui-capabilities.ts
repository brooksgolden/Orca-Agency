import { getRemoteRuntimeStatus } from './web-runtime-calls'
import { requireActiveEnvironmentOrNull } from './web-runtime-session'

// Why a TTL and not a permanent answer: the host can update under a paired browser.
const HOST_UI_CAPABILITIES_TTL_MS = 5 * 60_000
let hostUiCapabilities: {
  environmentId: string
  readAt: number
  capabilities: readonly string[]
} | null = null

export async function readHostUiCapabilities(): Promise<readonly string[] | null> {
  const environment = requireActiveEnvironmentOrNull()
  if (!environment) {
    return null
  }
  if (
    hostUiCapabilities?.environmentId === environment.id &&
    Date.now() - hostUiCapabilities.readAt < HOST_UI_CAPABILITIES_TTL_MS
  ) {
    return hostUiCapabilities.capabilities
  }
  const status = await getRemoteRuntimeStatus().catch(() => null)
  if (!status) {
    return null
  }
  const capabilities = status.capabilities ?? []
  hostUiCapabilities = { environmentId: environment.id, readAt: Date.now(), capabilities }
  return capabilities
}

export function resetHostUiCapabilitiesForTest(): void {
  hostUiCapabilities = null
}
