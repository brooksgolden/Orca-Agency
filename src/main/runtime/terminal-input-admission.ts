import type { OrcaRuntimeService } from './orca-runtime'

export type TerminalInputSource = 'desktop' | 'programmatic' | 'mobile' | 'legacy'
export class TerminalInputPausedError extends Error {}

type InputDriver = Pick<OrcaRuntimeService, 'getDriver'>

export function isTerminalInputPaused(
  runtime: InputDriver,
  ptyId: string,
  source: TerminalInputSource = 'programmatic'
): boolean {
  return source === 'desktop' && runtime.getDriver(ptyId).kind === 'mobile'
}

export function assertTerminalInputAdmitted(
  runtime: InputDriver,
  ptyId: string,
  source: TerminalInputSource = 'programmatic'
): void {
  if (isTerminalInputPaused(runtime, ptyId, source)) {
    throw new TerminalInputPausedError()
  }
}

export function createTerminalInputReservation(
  runtime: InputDriver,
  source: TerminalInputSource | undefined,
  reserveWrite: ((ptyId: string) => void) | undefined,
  recheckAdmission = false
): (ptyId: string) => void {
  let first = true
  return (ptyId) => {
    // By default, accepted input belongs to this operation through its chunks and first Enter.
    if (first || recheckAdmission) {
      assertTerminalInputAdmitted(runtime, ptyId, source)
      first = false
    }
    reserveWrite?.(ptyId)
  }
}
