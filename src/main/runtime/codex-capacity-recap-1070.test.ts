import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { RuntimeTerminalRead } from '../../shared/runtime-terminal-read'
import { isCodexCapacityScreen } from './codex-capacity-recovery'

// Synthetic transcription of the October 28 mobile screenshot (identifiers kept, not a raw PTY capture).
const captured = readFileSync(
  join(import.meta.dirname, '__fixtures__', 'codex-capacity-recap-1070-screenshot.txt'),
  'utf8'
).trimEnd()

function screen(
  text = captured,
  overrides: Partial<RuntimeTerminalRead> = {}
): RuntimeTerminalRead {
  return {
    handle: 'recap-1070',
    status: 'running',
    source: 'screen',
    composerState: 'empty',
    tail: text.split('\n'),
    truncated: false,
    nextCursor: null,
    ...overrides
  }
}

describe('capacity failure followed by the 1070 multiline recap', () => {
  it('accepts the reported screen with a multiline indented recap and Next line', () => {
    expect(isCodexCapacityScreen(screen())).toBe(true)
  })

  it('accepts punctuation inside a marked recap continuation', () => {
    const asked = captured.replace(
      'activity with live system counters.',
      'activity with live system counters?'
    )
    expect(isCodexCapacityScreen(screen(asked))).toBe(true)
  })

  it('rejects a new user bullet after the recap', () => {
    const bullet = captured.replace('› Ask Codex', '• Please keep the draft I wrote\n\n› Ask Codex')
    expect(isCodexCapacityScreen(screen(bullet))).toBe(false)
  })

  it('rejects when the composer already holds a user draft', () => {
    expect(
      isCodexCapacityScreen(screen(captured, { composerState: 'draft', draft: 'my note' }))
    ).toBe(false)
  })
})
