import { describe, expect, it } from 'vitest'
import type { RuntimeTerminalRead } from '../../shared/runtime-terminal-read'
import { hasCodexBusyQueueHint, matchesCodexBusyQueueComposer } from './codex-busy-queue-prompt'

function read(overrides: Partial<RuntimeTerminalRead> = {}): RuntimeTerminalRead {
  return {
    handle: 'term-1',
    status: 'running',
    source: 'screen',
    tail: ['tab to queue message'],
    composerState: 'empty',
    truncated: false,
    nextCursor: null,
    ...overrides
  }
}

describe('Codex busy composer queue proof', () => {
  it('matches trimmed composer text and multiple folded fragments without losing literal checks', () => {
    expect(
      matchesCodexBusyQueueComposer(
        read({ composerState: 'draft', draft: 'handoff' }),
        '\n handoff\n'
      )
    ).toBe(true)
    expect(
      matchesCodexBusyQueueComposer(
        read({
          composerState: 'draft',
          draft: 'a[Pasted Content 2 chars]b[Pasted Content 1 chars]c'
        }),
        'a🦄xbzc'
      )
    ).toBe(true)
    expect(
      matchesCodexBusyQueueComposer(
        read({ composerState: 'draft', draft: 'a[Pasted Content 4 chars]c' }),
        'a🦄xc'
      )
    ).toBe(false)
  })
  it('requires the captured queue hint from a rendered screen', () => {
    expect(hasCodexBusyQueueHint(read())).toBe(true)
    expect(hasCodexBusyQueueHint(read({ tail: ['Press Enter to send'] }))).toBe(false)
    expect(
      hasCodexBusyQueueHint(
        read({ tail: ['Tab to queue message', 'line 1', 'line 2', 'line 3', 'line 4', 'line 5'] })
      )
    ).toBe(false)
    expect(hasCodexBusyQueueHint(read({ source: 'stream' }))).toBe(false)
  })

  it('matches only the exact prompt draft in the queue composer', () => {
    expect(
      matchesCodexBusyQueueComposer(
        read({ composerState: 'draft', draft: 'sentinel prompt' }),
        'sentinel prompt'
      )
    ).toBe(true)
    expect(
      matchesCodexBusyQueueComposer(
        read({ composerState: 'draft', draft: 'sentinel prompt plus user input' }),
        'sentinel prompt'
      )
    ).toBe(false)
    expect(
      matchesCodexBusyQueueComposer(
        read({ composerState: 'draft', draft: 'sentinel prompt', tail: ['Press Enter to send'] }),
        'sentinel prompt'
      )
    ).toBe(false)
  })

  it('expands only a count-matched Codex folded paste between exact literal fragments', () => {
    const hidden = '\u{1F984}x'.repeat(400)
    const expected = `prefix-${hidden}-suffix`
    const folded = `prefix-[Pasted Content ${Array.from(hidden).length} chars]-suffix`
    expect(
      matchesCodexBusyQueueComposer(read({ composerState: 'draft', draft: folded }), expected)
    ).toBe(true)
    expect(
      matchesCodexBusyQueueComposer(
        read({
          composerState: 'draft',
          draft: `prefix-[Pasted Content ${Array.from(hidden).length - 1} chars]-suffix`
        }),
        expected
      )
    ).toBe(false)
    expect(
      matchesCodexBusyQueueComposer(
        read({
          composerState: 'draft',
          draft: `different-[Pasted Content ${Array.from(hidden).length} chars]-suffix`
        }),
        expected
      )
    ).toBe(false)
    expect(
      matchesCodexBusyQueueComposer(
        read({
          composerState: 'draft',
          draft: `prefix-[Pasted Content ${Array.from(hidden).length} chars]-different`
        }),
        expected
      )
    ).toBe(false)
  })
})
