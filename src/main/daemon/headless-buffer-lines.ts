import type { Terminal } from '@xterm/headless'

export function cursorFollowingLines(terminal: Terminal, limit: number): string[] {
  const buffer = terminal.buffer.active
  const start = buffer.baseY + buffer.cursorY + 1
  const end = Math.min(buffer.length, start + Math.max(0, Math.min(4, limit)))
  const lines: string[] = []
  for (let row = start; row < end; row++) {
    lines.push(buffer.getLine(row)?.translateToString(true) ?? '')
  }
  return lines
}

export function bufferTailLines(terminal: Terminal, limit: number): string[] {
  const buffer = terminal.buffer.active
  const start = Math.max(0, buffer.length - Math.max(0, Math.floor(limit)))
  const lines: string[] = []
  for (let row = start; row < buffer.length; row++) {
    lines.push(buffer.getLine(row)?.translateToString(true) ?? '')
  }
  return lines
}
