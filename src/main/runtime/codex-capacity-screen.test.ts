import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { RuntimeTerminalRead } from '../../shared/runtime-terminal-read'
import { isCodexCapacityScreen } from './codex-capacity-screen'
import { HeadlessEmulator } from '../daemon/headless-emulator'

// Screen text transcribed from the reported October 27 mobile frame; identifiers scrubbed.
const captured = readFileSync(
  join(import.meta.dirname, '__fixtures__', 'codex-capacity-recap-screen.txt'),
  'utf8'
).trimEnd()
function screen(text = captured): RuntimeTerminalRead {
  return {
    handle: 'recap',
    status: 'running',
    source: 'screen',
    composerState: 'empty',
    tail: text.split('\n'),
    truncated: false,
    nextCursor: null
  }
}

describe('exact Bad Request screen', () => {
  it('accepts only the captured Codex error with an empty composer', () => {
    expect(isCodexCapacityScreen(screen('\u25a0 {"detail":"Bad Request"}'), 'bad-request')).toBe(
      true
    )
    expect(isCodexCapacityScreen(screen('  \u25a0 {"detail":"Bad Request"}'), 'bad-request')).toBe(
      false
    )
    expect(
      isCodexCapacityScreen(
        screen('\u25a0 {"detail":"Bad Request - invalid model"}'),
        'bad-request'
      )
    ).toBe(false)
    expect(
      isCodexCapacityScreen(
        { ...screen('\u25a0 {"detail":"Bad Request"}'), composerState: 'unknown' },
        'bad-request'
      )
    ).toBe(false)
    expect(isCodexCapacityScreen(screen('\u25a0 {"detail":"Bad Request"}'))).toBe(false)
  })
  it('recognizes the reported error followed by a wrapped Codex recap', () => {
    const bad = captured.replace(
      /^.*Selected model is at capacity\. Please try a different model\./,
      '\u25a0 {"detail":"Bad Request"}'
    )
    expect(isCodexCapacityScreen(screen(bad), 'bad-request')).toBe(true)
  })
  it.each([
    '\u25a0 {"deta\nil":"Bad Request"}',
    '\u25a0 {"detail":"Bad Re\nquest"}',
    '\u25a0 {"de\n  tail":"Ba\n  d Re\n  quest"}'
  ])('accepts a soft wrap inside the exact error: %s', (bad) => {
    expect(isCodexCapacityScreen(screen(bad), 'bad-request')).toBe(true)
  })
  it('does not accept extra text in a wrapped error', () => {
    expect(
      isCodexCapacityScreen(
        screen('\u25a0 {"detail":"Bad Re\nquest - invalid model"}'),
        'bad-request'
      )
    ).toBe(false)
  })
  it.each([12, 16, 20])('recognizes a real terminal wrap at %i columns', async (cols) => {
    const emulator = new HeadlessEmulator({ cols, rows: 8 })
    try {
      await emulator.write('\u25a0 {"detail":"Bad Request"}')
      expect(
        isCodexCapacityScreen({ ...screen(), tail: emulator.getVisibleLines() }, 'bad-request')
      ).toBe(true)
    } finally {
      emulator.dispose()
    }
  })
})

describe('capacity failure followed by a wrapped recap', () => {
  it('rejects an indented error quoted by an ordinary response', () => {
    expect(
      isCodexCapacityScreen(
        screen(
          [
            '• Root failed with:',
            `  ${captured.split('\n')[0]}`,
            '› Ask Codex to do anything',
            'GPT-6.1-Sol default'
          ].join('\n')
        )
      )
    ).toBe(false)
  })
  it('accepts the reported mobile screen, including Next and background chrome', () => {
    expect(isCodexCapacityScreen(screen())).toBe(true)
  })
  it.each([40, 60, 100])('accepts recap rows rendered on a %i-column terminal', async (cols) => {
    const recap = captured
      .split('\n')
      .filter((line) => /^(?:  ↳ Recap:|    \S)/.test(line))
      .map((line) => line.replace(/^\s*↳ Recap:\s*/, '').trim())
      .join(' ')
    const words = `↳ Recap: ${recap}`.split(' ')
    const rows: string[] = []
    let line = '  '
    for (const word of words) {
      if (line.length + word.length + 1 > cols) {
        rows.push(line.trimEnd())
        line = '    '
      }
      line += `${word} `
    }
    rows.push(line.trimEnd())
    const emulator = new HeadlessEmulator({ cols, rows: 40 })
    try {
      await emulator.write(
        [
          captured.split('\n')[0],
          '',
          ...rows,
          '',
          '1 background terminal running',
          '',
          '› Ask Codex to do anything',
          'G… Goal stalled (/goal resume)'
        ].join('\r\n')
      )
      expect(isCodexCapacityScreen({ ...screen(), tail: emulator.getVisibleLines() })).toBe(true)
    } finally {
      emulator.dispose()
    }
  })
  it.each([0, 1, 2])('accepts recap marker with %i leading spaces', (indent) => {
    expect(
      isCodexCapacityScreen(screen(captured.replace('  ↳ Recap:', `${' '.repeat(indent)}↳ Recap:`)))
    ).toBe(true)
  })
  it('accepts completed helpers before and after the recap', () => {
    const text = captured
      .replace('\n\n  ↳', '\n• Completed `/root/before`\n\n  ↳')
      .replace('\n1 background', '\n• Completed `/root/after`\n1 background')
    expect(isCodexCapacityScreen(screen(text))).toBe(true)
  })
  it.each([
    ['draft composer', { composerState: 'draft' as const }],
    ['unknown composer', { composerState: 'unknown' as const }],
    ['saved draft', { draft: 'leave this alone' }],
    ['exited process', { status: 'exited' as const }],
    ['unavailable screen', { source: 'screen-unavailable' as const }]
  ])('holds the same recap with %s', (_label, change) => {
    expect(isCodexCapacityScreen({ ...screen(), ...change })).toBe(false)
  })
  it.each([
    'Which account should I use?',
    '  Which account should I use?',
    '• Please approve deployment.',
    '› my unsent message',
    '  › my unsent message',
    'Finished successfully.',
    '  ↳ Recap:Summary without the captured delimiter',
    'Recap: This is an ordinary reply.'
  ])('does not swallow substantive content outside the recap: %s', (line) => {
    const text = captured.replace('\n1 background', `\n${line}\n1 background`)
    expect(isCodexCapacityScreen(screen(text))).toBe(false)
  })
  it('does not treat an indented question after background chrome as recap continuation', () => {
    expect(
      isCodexCapacityScreen(
        screen(captured.replace('/stop to close', '/stop to close\n  Do you approve?'))
      )
    ).toBe(false)
  })
  it.each([
    '  ↳ Recap: Done.\n  Which account should I use?',
    '  ↳ Recap: Done.\n  Reply with the deploy account to continue.',
    '  ↳ Recap: Done.\n  • Approve deployment now.',
    '  ↳ Recap: Done.\n    • Approve deployment now.',
    '   ↳ Recap: Incorrect marker indentation.'
  ])('holds questions even when adjacent to the recap: %s', (recap) => {
    expect(
      isCodexCapacityScreen(
        screen(`${captured.split('\n')[0]}\n${recap}\n› Ask Codex to do anything`)
      )
    ).toBe(false)
  })
  it.each([
    '  ↳ Recap: Done. May I deploy?',
    '  ↳ Recap: Done.\n    Which account should I use？',
    '  ↳ Recap: Done.\n    Next: May I deploy the\n    reviewed changes?'
  ])('accepts question punctuation inside the marked recap: %s', (recap) => {
    expect(
      isCodexCapacityScreen(
        screen(`${captured.split('\n')[0]}\n${recap}\n› Ask Codex to do anything`)
      )
    ).toBe(true)
  })
  it('requires the exact provider error even when the recap and composer match', () => {
    expect(
      isCodexCapacityScreen(screen(captured.replace('Selected model is at capacity.', 'Done.')))
    ).toBe(false)
  })
})
