import type { RuntimeTerminalRead } from '../../shared/runtime-terminal-read'
import { capacityGoalFooterState } from './codex-capacity-goal'

// A host resize can wrap inside a word before Codex repaints for the new width.
const CAPACITY_NOTICE = new RegExp(
  `(?:^|\\n)\u25a0\\s*${'Selected model is at capacity. Please try a different model.'
    .split(' ')
    .map((word) => [...word].map((char) => (char === '.' ? '\\.' : char)).join('(?:\\n[ \\t]*)?'))
    .join('\\s+')}`,
  'g'
)

// A narrow terminal can soft-wrap within a JSON key or word. Only a newline
// and its visual indentation may occur inside a token, never arbitrary text.
const wrappedToken = (word: string): string => [...word].join('(?:\\n[ \\t]*)?')
const softWrap = '(?:\\n[ \\t]*)?'
const BAD_REQUEST_NOTICE = new RegExp(
  `(?:^|\\n)\\u25a0\\s*\\{\\s*"${softWrap}${wrappedToken('detail')}${softWrap}"\\s*:\\s*"${softWrap}${wrappedToken('Bad')}\\s+${wrappedToken('Request')}${softWrap}"\\s*\\}`,
  'g'
)

export function isCodexCapacitySafeChrome(line: string): boolean {
  return (
    /^\s*\u2022 Completed `\/root\/[a-zA-Z0-9_/-]+`\s*$/.test(line) ||
    capacityGoalFooterState(line) !== 'unknown' ||
    /^\s*\d+ background terminals? running(?:\s*\u00b7\s*\/ps to view(?:\s*\u00b7\s*\/stop to close)?)?\s*$/.test(
      line
    )
  )
}

/** Recaps are indented terminal chrome, not a new assistant reply after the error. */
export function isCodexCapacityScreen(
  read: RuntimeTerminalRead,
  kind: 'capacity' | 'bad-request' = 'capacity'
): boolean {
  if (
    read.status !== 'running' ||
    read.source !== 'screen' ||
    read.composerState !== 'empty' ||
    read.draft?.trim()
  ) {
    return false
  }
  const text = read.tail.join('\n')
  const match = [...text.matchAll(kind === 'capacity' ? CAPACITY_NOTICE : BAD_REQUEST_NOTICE)].at(
    -1
  )
  if (!match) {
    return false
  }
  let inRecap = false
  const remaining: string[] = []
  for (const line of text.slice(match.index + match[0].length).split('\n')) {
    if (!line.trim()) {
      // Codex can paint spacer rows inside a tall recap. A blank row is not
      // evidence that a new assistant or user turn started.
      continue
    }
    if (isCodexCapacitySafeChrome(line)) {
      inRecap = false
      continue
    }
    if (/^\s{0,2}\u21b3 Recap:\s+\S/.test(line)) {
      inRecap = true
      continue
    }
    // Composer and footer end the recap even when their own text is indented.
    if (/^\s*(?:[\u203a>]|GPT-)/.test(line)) {
      inRecap = false
    }
    if (inRecap && /^ {4,}\S/.test(line)) {
      if (/^\s*[\u2022\u25a0\u203a>]/.test(line)) {
        return false
      }
      continue
    }
    inRecap = false
    remaining.push(line)
  }
  const after = remaining.join('\n').trim()
  return (
    after === '' ||
    /^(?:[\u203a>](?:\s*Ask Codex to do anything)?\s*)?(?:GPT-[^\n]*\s*)?(?:\? for shortcuts)?$/.test(
      after
    )
  )
}

export function isCodexCapacityDraftScreen(
  read: RuntimeTerminalRead,
  kind: 'capacity' | 'bad-request',
  command: string
): boolean {
  return (
    read.composerState === 'draft' &&
    read.draft?.trim() === command &&
    isCodexCapacityScreen({ ...read, composerState: 'empty', draft: undefined }, kind)
  )
}
