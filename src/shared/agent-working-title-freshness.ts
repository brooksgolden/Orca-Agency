import { AGENT_STATUS_STALE_AFTER_MS } from './agent-status-types'

// Renew before the stale timer can briefly flash an orange status.
export const AGENT_WORKING_TITLE_REFRESH_AFTER_MS = AGENT_STATUS_STALE_AFTER_MS - 5 * 60_000
