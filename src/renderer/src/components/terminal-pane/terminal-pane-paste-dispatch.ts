import { pasteTerminalText } from './terminal-bracketed-paste'
import { executeTerminalPastePlan } from './terminal-paste-executor'
import { planTerminalPasteWithYield } from './terminal-paste-coordinator'
import type {
  TerminalPasteExecutionResult,
  TerminalPasteRuntime,
  TerminalPasteSource,
  TerminalPasteTextOptions
} from './terminal-paste-model'
import { writeTerminalPastePtyInput } from './terminal-pty-paste-writer'
import { captureTerminalPasteLatency } from './terminal-paste-latency-capture'

type PasteTextIntoTerminalPaneArgs = {
  pane: {
    id: number
    leafId: string
    terminal: Parameters<typeof pasteTerminalText>[0] &
      Parameters<typeof captureTerminalPasteLatency>[0]
  }
  text: string
  source: TerminalPasteSource
  ptyId: string | null
  runtime: TerminalPasteRuntime
  transport: Parameters<typeof writeTerminalPastePtyInput>[0]
  inputKind: 'driving' | 'launch'
  isTargetCurrent: () => boolean
  canContinue: () => boolean
  planOptions?: Pick<
    TerminalPasteTextOptions,
    'forceBracketedPaste' | 'forceBracketedPasteForMultiline' | 'windowsInputRecordNewline'
  >
  /** Agency Windows paste latency capture; the caller decides whether this paste is measured. */
  latency?: { enabled: boolean; requestedAtMs: number; clipboardReadyAtMs: number }
}

export async function pasteTextIntoTerminalPane({
  pane,
  text,
  source,
  ptyId,
  runtime,
  transport,
  inputKind,
  isTargetCurrent,
  canContinue,
  planOptions,
  latency
}: PasteTextIntoTerminalPaneArgs): Promise<TerminalPasteExecutionResult> {
  const plan = await planTerminalPasteWithYield({
    text,
    source,
    target: { kind: 'terminal', paneId: pane.id, leafId: pane.leafId, ptyId, runtime },
    forceBracketedPaste: planOptions?.forceBracketedPaste,
    forceBracketedPasteForMultiline: planOptions?.forceBracketedPasteForMultiline,
    windowsInputRecordNewline: planOptions?.windowsInputRecordNewline,
    terminalBracketedPasteMode: pane.terminal.modes?.bracketedPasteMode === true
  })
  const plannedAtMs = performance.now()
  const latencyCapture: { current: ReturnType<typeof captureTerminalPasteLatency> | null } = {
    current: null
  }
  try {
    return await executeTerminalPastePlan(plan, {
      onTransactionStart: () => {
        if (latency?.enabled && plan.mode !== 'reject' && source !== 'programmatic') {
          latencyCapture.current = captureTerminalPasteLatency(pane.terminal, plan, {
            requestedAtMs: latency.requestedAtMs,
            clipboardReadyAtMs: latency.clipboardReadyAtMs,
            plannedAtMs
          })
        }
      },
      onTransactionEnd: (result) => latencyCapture.current?.complete(result),
      onTransactionError: () => latencyCapture.current?.cancel(),
      pasteText: (pasteText, pasteOptions) => {
        latencyCapture.current?.markDispatched()
        return pasteTerminalText(pane.terminal, pasteText, pasteOptions)
      },
      writePty: (data, signal) => {
        latencyCapture.current?.markDispatched()
        return writeTerminalPastePtyInput(transport, data, inputKind, signal)
      },
      isTargetCurrent,
      canContinue
    })
  } catch (error) {
    latencyCapture.current?.cancel()
    throw error
  }
}
