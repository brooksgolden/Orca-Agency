import { appendBoundedDiagnosticLine } from './main-thread-file-capture'

const MAX_PENDING_LINES = 32

export function createTerminalLatencyFileCapture(
  path: string,
  append: (path: string, line: string) => Promise<void> = appendBoundedDiagnosticLine
): (line: string) => void {
  const pending: string[] = []
  let active = false
  return (line) => {
    if (pending.length === MAX_PENDING_LINES) {
      pending.shift()
    }
    pending.push(`${line}\n`)
    if (active) {
      return
    }
    active = true
    void (async () => {
      while (pending.length > 0) {
        const next = pending.shift()
        if (next === undefined) {
          break
        }
        try {
          await append(path, next)
        } catch {
          // Diagnostics must not block input or retry failed disk writes.
        }
      }
      active = false
    })()
  }
}
