import { describe, expect, it, vi } from 'vitest'
import type { RuntimeTerminalRead } from '../../shared/runtime-terminal-read'
import { isCodexCapacityDraftScreen, isCodexCapacityScreen } from './codex-capacity-screen'
import { readCapacityRecoveryScreen } from './runtime-codex-capacity-recovery'

const NOTICE = '■ Selected model is at capacity. Please try a different model.'
const visible = (): RuntimeTerminalRead => ({
  handle: 'term-test',
  status: 'running',
  source: 'screen',
  composerState: 'unknown',
  tail: ['› Ask Codex to do anything', 'GPT-6.1-Sol default · fixture'],
  truncated: false,
  nextCursor: null
})

async function mergeHistory(tail: string[]): Promise<RuntimeTerminalRead> {
  const screen = visible()
  const history: RuntimeTerminalRead = { ...screen, source: 'stream', tail }
  const readTerminal = vi.fn().mockResolvedValueOnce(screen).mockResolvedValueOnce(history)
  return readCapacityRecoveryScreen({ readTerminal } as never, 'term-test')
}

describe('short-pane capacity history reconstruction', () => {
  it.each([
    ['capacity question', NOTICE, '• Which account should I use?'],
    ['Bad Request question', '■ {"detail":"Bad Request"}', '• Which account should I use?'],
    ['completion after recap', NOTICE, '• Finished successfully.']
  ])('rejects later substantive stream history: %s', async (label, failure, later) => {
    const recap =
      label === 'completion after recap'
        ? ['  ↳ Recap: interrupted work', '           Next: Retry the request.']
        : []
    const merged = await mergeHistory([
      failure,
      '› Ask Codex to do anything',
      'GPT-6.1-Sol default · fixture',
      ...recap,
      later,
      '› Ask Codex to do anything',
      'GPT-6.1-Sol default · fixture'
    ])
    expect(isCodexCapacityScreen(merged)).toBe(false)
  })

  it.each([
    '• Completed `/root/helper`',
    '1 background terminal running · /ps to view · /stop to close',
    'G… Goal stalled (/goal resume)    ⚠ 3 warnings · f2 to view'
  ])('preserves safe stream chrome: %s', async (chrome) => {
    const merged = await mergeHistory([
      NOTICE,
      '  ↳ Recap: interrupted work remains resumable',
      '           Next: Retry the request.',
      chrome,
      '› Ask Codex to do anything',
      'GPT-6.1-Sol default · fixture'
    ])
    expect(isCodexCapacityScreen(merged)).toBe(true)
  })

  it.each(['Continue', '/goal resume'])(
    'preserves the exact owned parked draft: %s',
    async (draft) => {
      const parked: RuntimeTerminalRead = {
        ...visible(),
        composerState: 'draft',
        draft,
        tail: ['           recap continuation', '›', 'GPT-6.1-Sol default · fixture']
      }
      const history: RuntimeTerminalRead = {
        ...parked,
        source: 'stream',
        tail: [
          NOTICE,
          '  ↳ Recap: interrupted work remains resumable',
          '           recap continuation',
          '› Ask Codex to do anything',
          'GPT-6.1-Sol default · fixture',
          draft,
          `› ${draft}`
        ]
      }
      const readTerminal = vi.fn().mockResolvedValueOnce(parked).mockResolvedValueOnce(history)
      const merged = await readCapacityRecoveryScreen({ readTerminal } as never, 'term-test')
      expect(isCodexCapacityDraftScreen(merged, 'capacity', draft)).toBe(true)
    }
  )
})
