import { describe, expect, it } from 'vitest'
import { chatUiLaunchTipVariant } from './chat-ui-launch-tip-audience'

describe('chatUiLaunchTipVariant', () => {
  it.each([
    ['eligible', 'chat-ui-on', 'chat-ui-on'],
    ['eligible', 'chat-ui-on-terminal-default', 'keep-terminal'],
    ['eligible', 'chat-ui-off', 'chat-ui-off'],
    ['excluded', 'chat-ui-on', 'none'],
    ['excluded', 'chat-ui-on-terminal-default', 'none'],
    ['excluded', 'chat-ui-on-unproven', 'none'],
    ['excluded', 'chat-ui-off', 'none'],
    ['excluded', 'chat-ui-unset', 'none'],
    ['excluded', 'new-profile', 'none']
  ] as const)('gives %s/%s the %s tip', (membership, basis, variant) => {
    expect(chatUiLaunchTipVariant({ version: 1, membership, basis })).toBe(variant)
  })

  it('shows no tip without a readable record', () => {
    expect(chatUiLaunchTipVariant(null)).toBe('none')
  })
})
