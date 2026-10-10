import {
  detectTerminalComposerDraft,
  hasTerminalComposerPlaceholder
} from '../../shared/terminal-composer-draft'
import type { HeadlessEmulator } from '../daemon/headless-emulator'
import type { RuntimeTerminalProjection } from './orca-runtime-core'
import { visibleNonBlankTerminalLines } from './terminal-tail-read'

export function projectTerminalTailLines(
  emulator: HeadlessEmulator,
  limit: number
): RuntimeTerminalProjection {
  const tail = emulator.getBufferTailLines(limit)
  const visible = emulator.getVisibleLines()
  const visibleRange = emulator.getVisibleBufferRange()
  const cursorContext = emulator.getCursorLineContext()
  const draft = detectTerminalComposerDraft(cursorContext)
  const composerState = draft
    ? 'draft'
    : hasTerminalComposerPlaceholder(cursorContext)
      ? 'empty'
      : 'unknown'
  if (draft && visibleRange.endExclusive === visibleRange.totalLength) {
    visible[draft.promptRow] = draft.promptGlyph
    for (let row = draft.promptRow + 1; row <= draft.endRow; row += 1) {
      visible[row] = ''
    }
    const scrollbackTail = tail.slice(0, Math.max(0, tail.length - visible.length))
    tail.splice(0, tail.length, ...scrollbackTail, ...visibleNonBlankTerminalLines(visible))
  }
  return {
    lines: visibleNonBlankTerminalLines(tail).slice(-limit),
    ...(draft ? { draft: draft.text } : {}),
    composerState
  }
}

export function projectTerminalVisibleLines(emulator: HeadlessEmulator): RuntimeTerminalProjection {
  const visible = emulator.getVisibleLines()
  const cursorContext = emulator.getCursorLineContext()
  const draft = detectTerminalComposerDraft(cursorContext)
  const composerState = draft
    ? 'draft'
    : hasTerminalComposerPlaceholder(cursorContext)
      ? 'empty'
      : 'unknown'
  if (draft) {
    visible[draft.promptRow] = draft.promptGlyph
    for (let row = draft.promptRow + 1; row <= draft.endRow; row += 1) {
      visible[row] = ''
    }
  }
  return {
    lines: visibleNonBlankTerminalLines(visible),
    ...(draft ? { draft: draft.text } : {}),
    composerState
  }
}
