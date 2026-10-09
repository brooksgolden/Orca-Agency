import { bulkInputAtByPty, interactiveOutputCharsByPty, lastInputAtByPty } from './visibility-state'
import type { TerminalInputKind } from '../../../../shared/terminal-input-kind'
import {
  INTERACTIVE_OUTPUT_BUDGET_CHARS,
  INTERACTIVE_OUTPUT_MAX_CHARS,
  INTERACTIVE_OUTPUT_WINDOW_MS,
  INTERACTIVE_REDRAW_MAX_CHARS,
  PTY_BULK_INPUT_CONTINUATION_MS,
  PTY_BULK_INPUT_MAX_WINDOW_MS,
  PTY_BULK_INPUT_MIN_CHARS,
  PTY_BULK_INPUT_OUTPUT_WINDOW_MS
} from './constants'

export function notePtyInputForDelivery(
  id: string,
  data: string,
  inputKind: TerminalInputKind,
  now: number
): void {
  lastInputAtByPty.set(id, now)
  interactiveOutputCharsByPty.set(id, 0)
  // A paste makes Codex redraw hundreds of times. Batch its replies briefly;
  // a subsequent keystroke restores the immediate echo path at once.
  if (inputKind === 'driving' && data.length >= PTY_BULK_INPUT_MIN_CHARS) {
    bulkInputAtByPty.set(id, { startedAt: now, lastOutputAt: now })
  } else if (inputKind === 'driving') {
    const bulk = bulkInputAtByPty.get(id)
    // Bracketed paste closes in a separate tiny write for large inputs. The
    // renderer can also split a raw paste into 16 KiB writes with a short tail.
    if (
      !bulk ||
      (data !== '\x1b[201~' &&
        (data.length === 1 || now - bulk.startedAt > PTY_BULK_INPUT_CONTINUATION_MS))
    ) {
      bulkInputAtByPty.delete(id)
    }
  }
}

export function isPtyBulkInputOutputWindow(id: string, now: number): boolean {
  const bulk = bulkInputAtByPty.get(id)
  if (!bulk) {
    return false
  }
  if (
    now - bulk.startedAt <= PTY_BULK_INPUT_MAX_WINDOW_MS &&
    now - bulk.lastOutputAt <= PTY_BULK_INPUT_OUTPUT_WINDOW_MS
  ) {
    bulk.lastOutputAt = now
    return true
  }
  bulkInputAtByPty.delete(id)
  return false
}

export function isLikelyInteractiveRedraw(data: string): boolean {
  if (data.length <= INTERACTIVE_OUTPUT_MAX_CHARS) {
    return true
  }
  // Why the ANSI check: Codex-style TUIs repaint >1 KB per keypress (latency-sensitive), while plain command output should stay on the throughput batch path.
  return data.length <= INTERACTIVE_REDRAW_MAX_CHARS && data.includes('\x1b[')
}

export function shouldSendInteractiveOutputNow(id: string, data: string, now: number): boolean {
  if (isPtyBulkInputOutputWindow(id, now)) {
    return false
  }
  const lastInputAt = lastInputAtByPty.get(id)
  if (lastInputAt === undefined || now - lastInputAt > INTERACTIVE_OUTPUT_WINDOW_MS) {
    interactiveOutputCharsByPty.delete(id)
    return false
  }
  if (!isLikelyInteractiveRedraw(data)) {
    interactiveOutputCharsByPty.set(id, INTERACTIVE_OUTPUT_BUDGET_CHARS)
    return false
  }
  const usedChars = interactiveOutputCharsByPty.get(id) ?? 0
  if (usedChars + data.length > INTERACTIVE_OUTPUT_BUDGET_CHARS) {
    interactiveOutputCharsByPty.set(id, INTERACTIVE_OUTPUT_BUDGET_CHARS)
    return false
  }
  interactiveOutputCharsByPty.set(id, usedChars + data.length)
  return true
}
