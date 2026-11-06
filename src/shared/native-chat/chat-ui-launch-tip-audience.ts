export const CHAT_UI_LAUNCH_TIP_MEMBERSHIPS = ['eligible', 'excluded'] as const
export type ChatUiLaunchTipMembership = (typeof CHAT_UI_LAUNCH_TIP_MEMBERSHIPS)[number]

/** Why a profile landed in or out of the audience for the tip announcing Chat UI to everyone. */
export const CHAT_UI_LAUNCH_TIP_AUDIENCE_BASES = [
  /** An existing profile whose new agent launches opened in the terminal. */
  'chat-ui-off',
  /** An existing profile that had already opted into Chat UI. */
  'chat-ui-on',
  /** Chat UI was on with new tabs opening in the terminal before the upgrade; stays on the terminal. */
  'chat-ui-on-terminal-default',
  /** Chat UI was on, but nothing saved proves the opt-in predates the upgrade; excluded. */
  'chat-ui-on-unproven',
  /** Saved before Chat UI was set; excluded. */
  'chat-ui-unset',
  'new-profile',
  'unreadable-record'
] as const
export type ChatUiLaunchTipAudienceBasis = (typeof CHAT_UI_LAUNCH_TIP_AUDIENCE_BASES)[number]

/** Fixed from the saved profile on the first load after Chat UI left Experimental, never recomputed from live settings. */
export type ChatUiLaunchTipAudience = {
  version: 1
  membership: ChatUiLaunchTipMembership
  basis: ChatUiLaunchTipAudienceBasis
}

/**
 * Which tip a profile gets: none, the invitation for terminal users, the note for chat users, or
 * the terminal-default invitation for users who had Chat UI on but kept new tabs in the terminal.
 */
export type ChatUiLaunchTipVariant = 'none' | 'chat-ui-off' | 'chat-ui-on' | 'keep-terminal'

export function chatUiLaunchTipVariant(
  audience: ChatUiLaunchTipAudience | null
): ChatUiLaunchTipVariant {
  if (audience?.membership !== 'eligible') {
    return 'none'
  }
  switch (audience.basis) {
    case 'chat-ui-on':
      return 'chat-ui-on'
    case 'chat-ui-off':
      return 'chat-ui-off'
    case 'chat-ui-on-terminal-default':
      return 'keep-terminal'
    case 'chat-ui-on-unproven':
    case 'chat-ui-unset':
    case 'new-profile':
    case 'unreadable-record':
      return 'none'
  }
}

export function parseChatUiLaunchTipAudience(value: unknown): ChatUiLaunchTipAudience | null {
  if (!isRecord(value)) {
    return null
  }
  const membership = CHAT_UI_LAUNCH_TIP_MEMBERSHIPS.find((entry) => entry === value.membership)
  const basis = CHAT_UI_LAUNCH_TIP_AUDIENCE_BASES.find((entry) => entry === value.basis)
  if (value.version !== 1 || membership === undefined || basis === undefined) {
    return null
  }
  return { version: 1, membership, basis }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
