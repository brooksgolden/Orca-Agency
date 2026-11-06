import type { Terminal } from '@xterm/headless'

export class SynchronizedOutputState {
  active = false

  constructor(terminal: Terminal) {
    terminal.parser.registerCsiHandler({ prefix: '?', final: 'h' }, (params) => {
      if (params.includes(2026)) {
        this.active = true
      }
      return false
    })
    terminal.parser.registerCsiHandler({ prefix: '?', final: 'l' }, (params) => {
      if (params.includes(2026)) {
        this.active = false
      }
      return false
    })
  }
}
