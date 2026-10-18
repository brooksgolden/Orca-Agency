import { useAppStore } from '../../store'
import type { ManagedPane } from '@/lib/pane-manager/pane-manager'
import type { PtyTransport } from './pty-transport'
import { getConnectionId } from '@/lib/connection-context'
import { getRuntimeEnvironmentIdForWorktree } from '@/lib/worktree-runtime-owner'
import {
  executeTerminalPastePlan,
  planTerminalPasteWithYield,
  type TerminalPasteSource,
  type TerminalPasteTextOptions
} from './terminal-paste-coordinator'
import { resolveTerminalPasteRuntime } from './terminal-paste-runtime'
import { getTerminalPasteSshRemotePlatform } from './terminal-paste-ssh-platform'
import {
  isTerminalPanePasteFocusCurrent,
  isTerminalPanePasteTargetCurrent
} from './terminal-paste-target-state'
import { pasteTerminalText } from './terminal-bracketed-paste'
import { writeTerminalPastePtyInput } from './terminal-pty-paste-writer'
import { formatTerminalPasteExecutionError } from './terminal-paste-errors'
import { recordTerminalUserInputForLeaf } from './terminal-input-activity'
import { scheduleImagePasteWebglAtlasRecovery } from './terminal-webgl-atlas-recovery'
import { pasteTerminalClipboard } from './terminal-clipboard-paste'
import { captureTerminalPasteLatency } from './terminal-paste-latency-capture'
import { resolveProtectedMultilinePasteOptionsForPane } from './terminal-agent-paste-bracketing'
import { resolveTerminalInputHostPlatform } from './terminal-input-host-platform'
import type { ReadClipboardTextOptions } from '../../../../shared/clipboard-text'
import type { TerminalPaneCloseController } from './use-terminal-pane-close-actions'

export type TerminalPanePasteExecution = ReturnType<typeof createTerminalPanePasteExecution>

export function formatClipboardImagePasteError(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error)
  return `Image paste failed: ${detail}`
}

export function createTerminalPanePasteExecution(
  controller: TerminalPaneCloseController,
  shortcutPlatform: NodeJS.Platform
) {
  const {
    forceBracketedMultilineTextPaste,
    managerRef,
    paneTransportsRef,
    setTerminalError,
    tabId,
    worktreeId
  } = controller
  const isPanePasteTargetMounted = (
    pane: ManagedPane,
    transport: PtyTransport | undefined,
    ptyId: string | null
  ): boolean =>
    isTerminalPanePasteTargetCurrent({
      manager: managerRef.current,
      paneTransports: paneTransportsRef.current,
      paneId: pane.id,
      leafId: pane.leafId,
      transport,
      ptyId
    })

  const resolveProtectedMultilineOptions = (
    pane: ManagedPane
  ): TerminalPasteTextOptions | undefined => {
    const state = useAppStore.getState()
    const transport = paneTransportsRef.current.get(pane.id) ?? null
    return resolveProtectedMultilinePasteOptionsForPane({
      isWindowsClient: forceBracketedMultilineTextPaste,
      hostPlatform: resolveTerminalInputHostPlatform({
        clientPlatform: shortcutPlatform,
        state,
        worktreeId,
        transport
      }),
      agentStatusByPaneKey: state.agentStatusByPaneKey,
      paneForegroundAgentByPaneKey: state.paneForegroundAgentByPaneKey,
      tabId,
      leafId: pane.leafId
    })
  }

  const executePanePasteText = async (
    pane: ManagedPane,
    source: TerminalPasteSource,
    activeElementAtDispatch: Element | null,
    text: string,
    options?: TerminalPasteTextOptions,
    requestedAtMs = performance.now()
  ): Promise<void> => {
    const clipboardReadyAtMs = performance.now()
    const connectionId = getConnectionId(worktreeId) ?? null
    const transport = paneTransportsRef.current.get(pane.id)
    const ptyId = transport?.getPtyId() ?? null
    const keyboardOwnedPaste =
      source === 'keyboard' || source === 'paste-event' || source === 'app-menu'
    const plan = await planTerminalPasteWithYield({
      text,
      source,
      target: {
        kind: 'terminal',
        paneId: pane.id,
        leafId: pane.leafId,
        ptyId,
        runtime: resolveTerminalPasteRuntime({
          platform: shortcutPlatform,
          ptyId,
          connectionId,
          remotePlatform: getTerminalPasteSshRemotePlatform(connectionId),
          transport,
          isWindowsConpty: forceBracketedMultilineTextPaste
        })
      },
      forceBracketedPaste: options?.forceBracketedPaste,
      forceBracketedPasteForMultiline: options?.forceBracketedPasteForMultiline,
      windowsInputRecordNewline: options?.windowsInputRecordNewline,
      terminalBracketedPasteMode: pane.terminal.modes.bracketedPasteMode
    })
    const plannedAtMs = performance.now()
    const latencyCapture: { current: ReturnType<typeof captureTerminalPasteLatency> } = {
      current: null
    }
    let execution: Awaited<ReturnType<typeof executeTerminalPastePlan>>
    try {
      execution = await executeTerminalPastePlan(plan, {
        onTransactionStart: () => {
          if (
            shortcutPlatform === 'win32' &&
            plan.mode !== 'reject' &&
            source !== 'programmatic' &&
            !options?.recoverImagePasteWebglAtlas
          ) {
            latencyCapture.current = captureTerminalPasteLatency(pane.terminal, plan, {
              requestedAtMs,
              clipboardReadyAtMs,
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
          return writeTerminalPastePtyInput(transport, data, 'driving', signal)
        },
        isTargetCurrent: () => {
          if (!isPanePasteTargetMounted(pane, transport, ptyId)) {
            return false
          }
          return isTerminalPanePasteFocusCurrent({
            requireSameFocusedElement: keyboardOwnedPaste,
            activeElementAtDispatch,
            paneContainer: pane.container
          })
        },
        canContinue: () => isPanePasteTargetMounted(pane, transport, ptyId)
      })
    } catch (error) {
      latencyCapture.current?.cancel()
      throw error
    }
    if (execution.status !== 'pasted') {
      setTerminalError(formatTerminalPasteExecutionError(execution.reason))
      return
    }
    if (text) {
      recordTerminalUserInputForLeaf(tabId, pane.leafId)
    }
    if (options?.recoverImagePasteWebglAtlas) {
      scheduleImagePasteWebglAtlasRecovery()
    }
  }

  const pasteFromClipboard = (
    pane: ManagedPane,
    source: Extract<TerminalPasteSource, 'keyboard' | 'paste-event'>,
    readClipboardText: (options?: ReadClipboardTextOptions) => Promise<string> = window.api.ui
      .readClipboardText
  ): void => {
    const connectionId = getConnectionId(worktreeId) ?? null
    const state = useAppStore.getState()
    const runtimeEnvironmentId = getRuntimeEnvironmentIdForWorktree(state, worktreeId)
    const activeElementAtDispatch = document.activeElement
    const requestedAtMs = performance.now()
    void pasteTerminalClipboard({
      readClipboardText,
      saveClipboardImageAsTempFile: window.api.ui.saveClipboardImageAsTempFile,
      connectionId,
      runtimeEnvironmentId,
      forceBracketedMultilineTextPaste,
      protectedMultilineTextPasteOptions: resolveProtectedMultilineOptions(pane),
      pasteText: (text, options) =>
        executePanePasteText(pane, source, activeElementAtDispatch, text, options, requestedAtMs),
      onTextPasteError: () =>
        setTerminalError('Paste failed: clipboard text is too large for a safe terminal paste.'),
      onImagePasteError: (error) => setTerminalError(formatClipboardImagePasteError(error))
    }).catch(() => {
      setTerminalError('Paste failed.')
    })
  }

  return { executePanePasteText, pasteFromClipboard, resolveProtectedMultilineOptions }
}
