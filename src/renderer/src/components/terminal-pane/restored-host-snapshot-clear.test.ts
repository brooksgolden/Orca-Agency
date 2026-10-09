import { Terminal } from '@xterm/headless'
import { describe, expect, it } from 'vitest'
import { writeHeadlessTerminal } from './pty-connection-test-async'
import { restoredHostSnapshotClear } from './restored-host-snapshot-clear'

function allLines(terminal: Terminal): string[] {
  const lines: string[] = []
  for (let index = 0; index < terminal.buffer.active.length; index += 1) {
    lines.push(terminal.buffer.active.getLine(index)?.translateToString(true) ?? '')
  }
  return lines
}

describe('restoredHostSnapshotClear', () => {
  it('keeps saved rows when the host image starts at a fresh prompt', async () => {
    const terminal = new Terminal({ cols: 60, rows: 4 })
    try {
      await writeHeadlessTerminal(terminal, 'previous command output\r\nLINE:token-saved-only')
      const clear = restoredHostSnapshotClear(terminal, '\x1b[HPS >', false)
      expect(clear.retainsHistory).toBe(true)
      await writeHeadlessTerminal(terminal, clear.sequence)
      await writeHeadlessTerminal(terminal, '\x1b[HPS >')

      const secondClear = restoredHostSnapshotClear(terminal, '\x1b[HNEW >', false, true)
      await writeHeadlessTerminal(terminal, secondClear.sequence)
      await writeHeadlessTerminal(terminal, '\x1b[HNEW >')

      const lines = allLines(terminal)
      expect(lines.filter((line) => line.includes('LINE:token-saved-only'))).toHaveLength(1)
      expect(lines.filter((line) => line.includes('NEW >'))).toHaveLength(1)
      expect(secondClear.retainsHistory).toBe(true)
    } finally {
      terminal.dispose()
    }
  })

  it('clears the saved copy when the host image covers its significant lines', async () => {
    const terminal = new Terminal({ cols: 60, rows: 4 })
    const image = '\x1b[Hprevious command output\r\nLINE:token-covered'
    try {
      await writeHeadlessTerminal(terminal, 'previous command output\r\nLINE:token-covered')
      const clear = restoredHostSnapshotClear(terminal, image, false)
      expect(clear.sequence).toContain('\x1b[3J')
      expect(clear.retainsHistory).toBe(false)
      await writeHeadlessTerminal(terminal, clear.sequence)
      await writeHeadlessTerminal(terminal, image)

      expect(allLines(terminal).filter((line) => line.includes('LINE:token-covered'))).toHaveLength(
        1
      )
    } finally {
      terminal.dispose()
    }
  })

  it('keeps the regular clear for a full-screen host image', async () => {
    const terminal = new Terminal({ cols: 60, rows: 4 })
    try {
      expect(restoredHostSnapshotClear(terminal, '\x1b[?1049hAPP', true).sequence).toContain(
        '\x1b[3J'
      )
    } finally {
      terminal.dispose()
    }
  })
})
