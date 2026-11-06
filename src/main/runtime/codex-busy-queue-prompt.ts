import type { RuntimeTerminalRead } from '../../shared/runtime-terminal-read'

const CODEX_QUEUE_HINT = /\btab\s+to\s+queue\s+message\b/i

export function hasCodexBusyQueueHint(read: RuntimeTerminalRead): boolean {
  return read.source === 'screen' && CODEX_QUEUE_HINT.test(read.tail.slice(-5).join('\n'))
}

export function matchesCodexBusyQueueComposer(
  read: RuntimeTerminalRead,
  expectedDraft: string
): boolean {
  return hasCodexBusyQueueHint(read) && matchesCodexComposerDraft(read, expectedDraft)
}

export function matchesCodexComposerDraft(
  read: RuntimeTerminalRead,
  expectedDraft: string
): boolean {
  if (read.source !== 'screen' || read.composerState !== 'draft' || read.draft === undefined) {
    return false
  }
  const trimmed = expectedDraft.trim()
  return (
    read.draft === trimmed ||
    matchesFoldedCodexDraft(read.draft, expectedDraft) ||
    (trimmed !== expectedDraft && matchesFoldedCodexDraft(read.draft, trimmed))
  )
}

/** Only call after the exact draft was pasted under the unchanged input/process fence. */
function matchesFoldedCodexDraft(displayedDraft: string, expectedDraft: string): boolean {
  if (!displayedDraft.includes('[Pasted Content ')) {
    return false
  }
  let expectedOffset = 0
  let displayedOffset = 0
  for (const marker of displayedDraft.matchAll(/\[Pasted Content (\d+) chars\]/g)) {
    const index = marker.index
    const literal = displayedDraft.slice(displayedOffset, index)
    if (!expectedDraft.startsWith(literal, expectedOffset)) {
      return false
    }
    expectedOffset += literal.length

    const foldedCount = Number(marker[1])
    if (
      !Number.isSafeInteger(foldedCount) ||
      foldedCount <= 0 ||
      expectedOffset + foldedCount > expectedDraft.length
    ) {
      return false
    }
    for (let count = 0; count < foldedCount; count++) {
      const point = expectedDraft.codePointAt(expectedOffset)
      if (point === undefined) {
        return false
      }
      expectedOffset += point > 0xffff ? 2 : 1
    }
    displayedOffset = index + marker[0].length
  }

  const suffix = displayedDraft.slice(displayedOffset)
  return expectedDraft.slice(expectedOffset) === suffix
}
