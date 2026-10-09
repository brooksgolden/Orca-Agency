import {
  stripAnsiEscapeSequences,
  TERMINAL_CONTROL_CHARACTER_PATTERN
} from '../../../../shared/ansi-escape-sequences'
import { RELEASE_SYNCHRONIZED_OUTPUT } from '../../../../shared/terminal-mode-reset-profiles'
import { buildFreshShellViewportBlankingSequence } from './terminal-restored-viewport'

type TerminalWithRows = {
  rows: number
  buffer: {
    active: {
      type: string
      baseY: number
      getLine: (index: number) => { translateToString: (trimRight?: boolean) => string } | undefined
    }
  }
}

const CLEAR_REPLAY_IMAGE = `${RELEASE_SYNCHRONIZED_OUTPUT}\x1b[2J\x1b[3J\x1b[H`

export function restoredHostSnapshotClear(
  terminal: TerminalWithRows,
  snapshot: string,
  alternateScreen: boolean | undefined,
  historyAlreadyProtected = false
): { sequence: string; retainsHistory: boolean } {
  const buffer = terminal.buffer.active
  if (alternateScreen || buffer.type === 'alternate') {
    return { sequence: CLEAR_REPLAY_IMAGE, retainsHistory: false }
  }
  if (historyAlreadyProtected) {
    return { sequence: `${RELEASE_SYNCHRONIZED_OUTPUT}\x1b[2J\x1b[H`, retainsHistory: true }
  }

  const significantLines: string[] = []
  const lastLine = buffer.baseY + terminal.rows - 1
  for (let index = lastLine; index >= 0 && significantLines.length < 3; index -= 1) {
    const line = buffer.getLine(index)?.translateToString(true).trim()
    if (line && line.length >= 12) {
      significantLines.push(line)
    }
  }
  const snapshotText = stripAnsiEscapeSequences(snapshot).replace(
    TERMINAL_CONTROL_CHARACTER_PATTERN,
    ''
  )
  if (
    significantLines.length >= 2 &&
    significantLines.every((line) => snapshotText.includes(line))
  ) {
    return { sequence: CLEAR_REPLAY_IMAGE, retainsHistory: false }
  }
  // Why: a host image can start after the client capture; 3J would delete its only copy.
  return {
    sequence: `${RELEASE_SYNCHRONIZED_OUTPUT}${buildFreshShellViewportBlankingSequence(terminal.rows)}`,
    retainsHistory: true
  }
}
