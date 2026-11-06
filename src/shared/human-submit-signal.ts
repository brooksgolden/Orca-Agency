// Why: only a person's keystrokes reach the renderer's user-input path (xterm's
// core user-input signal). Scripts, `orca terminal send`, orchestration and
// recovery writes arrive through main, so they never produce this signal.
// oxlint-disable-next-line no-control-regex -- escape sequences are matched by their ESC control byte.
const ESCAPE_SEQUENCE_RE = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b[@-Z\\-_]/g
// oxlint-disable-next-line no-control-regex -- C0 controls are the subject of this check.
const PRINTABLE_TEXT_RE = /[^\u0000-\u001f\u007f]/

/**
 * Tracks one terminal's typed-but-unsubmitted text. An Enter (CR) counts as a
 * human message only when text was typed since the previous submit, so empty
 * Enters, focus reports and escape keys are never messages.
 */
export function createHumanSubmitTracker(): {
  observe: (data: string, wasUserInput: boolean) => boolean
} {
  let typedSinceSubmit = false
  return {
    observe(data, wasUserInput) {
      if (!wasUserInput) {
        return false
      }
      const typed = data.replace(ESCAPE_SEQUENCE_RE, '')
      if (PRINTABLE_TEXT_RE.test(typed)) {
        typedSinceSubmit = true
      }
      if (typedSinceSubmit && data.includes('\r')) {
        typedSinceSubmit = false
        return true
      }
      return false
    }
  }
}
