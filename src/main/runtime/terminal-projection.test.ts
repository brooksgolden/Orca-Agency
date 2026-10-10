import { describe, expect, it } from 'vitest'
import type { TerminalCursorContext } from '../../shared/terminal-composer-draft'
import type { HeadlessEmulator } from '../daemon/headless-emulator'
import {
  projectTerminalTailLines,
  projectTerminalVisibleLines
} from './orca-runtime-terminal-projection'

describe('projectTerminalTailLines', () => {
  it('does not splice a scrolled viewport into unrelated tail rows', () => {
    const context: TerminalCursorContext = {
      rows: ['────────', '❯ proceed'],
      typedRows: ['────────', '❯'],
      promptGlyphBoldRows: [false, false],
      rowsBelow: [],
      typedRowsBelow: [],
      beforeCursor: '❯ ',
      afterCursor: '',
      rawAfterCursor: 'proceed',
      cursorHidden: false,
      cursorViewportRow: 1
    }
    const emulator = {
      getBufferTailLines: () => ['old output', 'tail output'],
      getVisibleLines: () => ['────────', '❯ proceed'],
      getVisibleBufferRange: () => ({ start: 0, endExclusive: 2, totalLength: 10 }),
      getCursorLineContext: () => context
    } as unknown as HeadlessEmulator

    expect(projectTerminalTailLines(emulator, 2)).toEqual({
      lines: ['old output', 'tail output'],
      draft: 'proceed',
      composerState: 'draft'
    })
  })

  it('backfills the prompt row when a small limit contains only draft continuations', () => {
    const context: TerminalCursorContext = {
      rows: ['────────', '❯ proceed'],
      typedRows: ['────────', '❯'],
      promptGlyphBoldRows: [false, false],
      rowsBelow: [' with', ' release'],
      typedRowsBelow: ['', ''],
      rowsBelowWrapped: [true, true],
      beforeCursor: '❯ ',
      afterCursor: '',
      rawAfterCursor: 'proceed',
      cursorHidden: false,
      cursorViewportRow: 2
    }
    const emulator = {
      getBufferTailLines: () => [' with', ' release'],
      getVisibleLines: () => ['Build passed', '────────', '❯ proceed', ' with', ' release'],
      getVisibleBufferRange: () => ({ start: 0, endExclusive: 5, totalLength: 5 }),
      getCursorLineContext: () => context
    } as unknown as HeadlessEmulator

    expect(projectTerminalTailLines(emulator, 2)).toEqual({
      lines: ['────────', '❯'],
      draft: 'proceed with release',
      composerState: 'draft'
    })
  })

  it('distinguishes a confirmed blank Codex placeholder from an unknown screen', () => {
    const context: TerminalCursorContext = {
      rows: ['\u203a Ask Codex to do anything'],
      typedRows: ['\u203a'],
      promptGlyphBoldRows: [true],
      rowsBelow: ['', 'gpt-5.6 \u00b7 ~/repo'],
      typedRowsBelow: ['', 'gpt-5.6 \u00b7 ~/repo'],
      beforeCursor: '\u203a ',
      afterCursor: '',
      rawAfterCursor: 'Ask Codex to do anything',
      cursorHidden: false,
      cursorViewportRow: 4
    }
    const emulator = {
      getBufferTailLines: () => ['\u203a Ask Codex to do anything'],
      getVisibleLines: () => ['\u203a Ask Codex to do anything'],
      getVisibleBufferRange: () => ({ start: 0, endExclusive: 1, totalLength: 1 }),
      getCursorLineContext: () => context
    }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: This fake implements only the projection methods under test.
    const testEmulator = emulator as unknown as HeadlessEmulator

    expect(projectTerminalTailLines(testEmulator, 2)).toMatchObject({ composerState: 'empty' })
    expect(projectTerminalTailLines(testEmulator, 2).draft).toBeUndefined()
    expect(projectTerminalVisibleLines(testEmulator)).toMatchObject({ composerState: 'empty' })
  })

  it('marks a visible screen without a recognized composer as unknown', () => {
    const emulator = {
      getVisibleLines: () => ['command output'],
      getCursorLineContext: () => null
    }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: This fake implements only the projection methods under test.
    const testEmulator = emulator as unknown as HeadlessEmulator

    expect(projectTerminalVisibleLines(testEmulator)).toEqual({
      lines: ['command output'],
      composerState: 'unknown'
    })
  })
})
