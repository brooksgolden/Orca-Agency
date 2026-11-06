import { ipcMain, type WebContents } from 'electron'
import type {
  TerminalPreviewConnectResult,
  TerminalPreviewSnapshot
} from '../../shared/terminal-preview'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { isDashboardPopoutRenderer } from '../window/dashboard-popout-window'
import { isTrustedUIRenderer } from './ui'
import {
  TERMINAL_PREVIEW_OUTPUT_BATCH_MAX_BYTES,
  TerminalPreviewOutputStream
} from './terminal-preview-output-stream'
import {
  previewSurfaceIdOf as surfaceIdOf,
  TerminalPreviewSurfaceRegistry
} from './terminal-preview-surface-registry'

const PREVIEW_ID_MAX_LENGTH = 4096

// Cap on ptys released per detach call; a grid never mounts more than this at once.
const DETACH_BATCH_MAX = 256

function isValidPtyId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= PREVIEW_ID_MAX_LENGTH
}

// Both popout and main-renderer overlay host previews; trusted UI already has ordinary PTY access.
function isTerminalPreviewRenderer(sender: WebContents): boolean {
  return isDashboardPopoutRenderer(sender) || isTrustedUIRenderer(sender)
}

/** Pop-out terminal transport with an atomic snapshot/live boundary. */
export function registerTerminalPreviewHandlers(runtime: OrcaRuntimeService): void {
  ipcMain.removeHandler('terminalPreview:connect')
  ipcMain.removeHandler('terminalPreview:unsubscribe')
  ipcMain.removeHandler('terminalPreview:input')
  ipcMain.removeHandler('terminalPreview:ack')
  ipcMain.removeHandler('terminalPreview:fit')
  ipcMain.removeHandler('terminalPreview:detach')

  // Why the surface in the key: one renderer can show the same pty on two
  // surfaces (a grid card and the dialog it opens). Sharing one viewer entry
  // let the second fit overwrite the first's grid, and closing that surface
  // left the survivor's dimensions unrecoverable. One viewer per surface lets
  // the runtime hand ownership back to whichever surface is still watching.
  const previewViewerKey = (contentsId: number, surfaceId: string): string =>
    `dashboard-popout:${contentsId}:${surfaceId}`

  const surfaces = new TerminalPreviewSurfaceRegistry((contentsId, ptyId, surfaceId) => {
    void runtime
      .unregisterRemoteDesktopViewer(ptyId, previewViewerKey(contentsId, surfaceId))
      .catch(() => undefined)
  })

  ipcMain.handle(
    'terminalPreview:connect',
    async (
      event,
      args: { ptyId?: unknown; opts?: { scrollbackRows?: unknown }; surfaceId?: unknown }
    ): Promise<TerminalPreviewConnectResult> => {
      const surfaceId = surfaceIdOf(args?.surfaceId)
      if (
        !isTerminalPreviewRenderer(event.sender) ||
        !isValidPtyId(args?.ptyId) ||
        surfaceId === null
      ) {
        return { snapshot: null, replay: [] }
      }
      const ptyId = args.ptyId
      surfaces.stream(event.sender.id, ptyId, surfaceId)?.dispose()

      const subscription = new TerminalPreviewOutputStream(
        event.sender,
        ptyId,
        runtime.registerRawTerminalViewSubscriber(ptyId),
        (stream) => surfaces.removeStream(stream),
        surfaceId
      )
      const unsubscribeData = runtime.subscribeToTerminalData(ptyId, (data, meta) =>
        subscription.append(data, meta)
      )
      let previewSize = runtime.getTerminalSize(ptyId)
      // Grid changes invalidate parsing at the old width; reconnect from a new authoritative snapshot.
      const unsubscribeResize = runtime.subscribeToTerminalResize(ptyId, (event) => {
        if (previewSize?.cols === event.cols && previewSize.rows === event.rows) {
          return
        }
        previewSize = { cols: event.cols, rows: event.rows }
        subscription.requestResync()
      })
      subscription.setDataSubscription(() => {
        unsubscribeData()
        unsubscribeResize()
      })
      surfaces.setStream(subscription)

      const requestedRows = args.opts?.scrollbackRows
      const scrollbackRows =
        typeof requestedRows === 'number' && Number.isFinite(requestedRows)
          ? Math.max(0, Math.min(1000, Math.floor(requestedRows)))
          : undefined
      let snapshot: TerminalPreviewSnapshot | null
      let resyncRequired = false
      try {
        // Why no explicit emulator hydration here: the runtime serializer
        // itself hydrates main's emulator whenever the pane's frame lags the
        // PTY grid, so every viewer path (this one, a phone's) gets the same.
        snapshot = await runtime.serializeTerminalBuffer(ptyId, { scrollbackRows })
        if (subscription.consumeInitialOverflow() && !subscription.disposed) {
          snapshot = await runtime.serializeTerminalBuffer(ptyId, { scrollbackRows })
          if (subscription.consumeInitialOverflow()) {
            // Never replay across an output gap; reconnect while retaining the previous frame.
            resyncRequired = true
          }
        }
      } catch {
        subscription.dispose()
        return { snapshot: null, replay: [], liveness: 'unverifiable' }
      }
      if (subscription.disposed) {
        return { snapshot: null, replay: [] }
      }
      if (!snapshot) {
        // Failed lookup has no future live boundary; release presence without waiting for unsubscribe.
        subscription.dispose()
        return {
          snapshot: null,
          replay: [],
          liveness: await runtime.verifyTerminalPreviewLiveness(ptyId)
        }
      }
      previewSize = { cols: snapshot.cols, rows: snapshot.rows }

      const replay = subscription.completeSnapshot(snapshot.seq)
      if (resyncRequired) {
        // Retired streams must not acknowledge bytes belonging to their replacement.
        subscription.pauseForReconnect()
      }
      return { snapshot, replay, ...(resyncRequired ? { resyncRequired: true } : {}) }
    }
  )

  ipcMain.handle(
    'terminalPreview:input',
    (event, args: { ptyId?: unknown; data?: unknown }): Promise<boolean> => {
      if (
        !isTerminalPreviewRenderer(event.sender) ||
        !isValidPtyId(args?.ptyId) ||
        typeof args.data !== 'string'
      ) {
        return Promise.resolve(false)
      }
      return runtime.writeTerminalPreviewInput(args.ptyId, args.data)
    }
  )

  ipcMain.handle(
    'terminalPreview:ack',
    (event, args: { ptyId?: unknown; bytes?: unknown; surfaceId?: unknown }): void => {
      const surfaceId = surfaceIdOf(args?.surfaceId)
      if (
        !isTerminalPreviewRenderer(event.sender) ||
        !isValidPtyId(args?.ptyId) ||
        surfaceId === null ||
        typeof args.bytes !== 'number' ||
        !Number.isFinite(args.bytes) ||
        args.bytes <= 0 ||
        args.bytes > TERMINAL_PREVIEW_OUTPUT_BATCH_MAX_BYTES
      ) {
        return
      }
      surfaces.stream(event.sender.id, args.ptyId, surfaceId)?.acknowledge(args.bytes)
    }
  )

  // Return effective viewer-claimed size so the renderer can scale when phone priority prevents fitting.
  ipcMain.handle(
    'terminalPreview:fit',
    async (
      event,
      args: { ptyId?: unknown; cols?: unknown; rows?: unknown; surfaceId?: unknown }
    ): Promise<{ cols: number; rows: number } | null> => {
      const surfaceId = surfaceIdOf(args?.surfaceId)
      if (
        !isTerminalPreviewRenderer(event.sender) ||
        !isValidPtyId(args?.ptyId) ||
        surfaceId === null ||
        typeof args.cols !== 'number' ||
        typeof args.rows !== 'number' ||
        !Number.isFinite(args.cols) ||
        !Number.isFinite(args.rows)
      ) {
        return null
      }
      const ptyId = args.ptyId
      const contentsId = event.sender.id
      // Why: guarantees the renderer-lifetime cleanup exists even if this claim outlives
      // the current output stream across a resync reconnect.
      surfaces.observe(event.sender)
      const claimToken = surfaces.claim(contentsId, ptyId, surfaceId)
      const claimStillHeld = (): boolean =>
        surfaces.holdsClaim(contentsId, ptyId, surfaceId, claimToken)
      const viewerKey = previewViewerKey(contentsId, surfaceId)
      try {
        const applied = await runtime.updateRemoteDesktopViewer(
          ptyId,
          viewerKey,
          viewerKey,
          args.cols,
          args.rows
        )
        if (!claimStillHeld()) {
          return null
        }
        if (!applied) {
          surfaces.releaseClaim(contentsId, ptyId, surfaceId)
          return null
        }
      } catch {
        if (claimStillHeld()) {
          surfaces.releaseClaim(contentsId, ptyId, surfaceId)
        }
        return null
      }
      return runtime.getTerminalSize(ptyId)
    }
  )

  ipcMain.handle(
    'terminalPreview:unsubscribe',
    (event, args: { ptyId?: unknown; surfaceId?: unknown }): void => {
      const surfaceId = surfaceIdOf(args?.surfaceId)
      if (
        !isTerminalPreviewRenderer(event.sender) ||
        !isValidPtyId(args?.ptyId) ||
        surfaceId === null
      ) {
        return
      }
      surfaces.stream(event.sender.id, args.ptyId, surfaceId)?.dispose()
      surfaces.releaseClaim(event.sender.id, args.ptyId, surfaceId)
    }
  )

  // Why one handler for many ptys: each released claim hands the PTY back to
  // its host pane, and every hand-back arms the runtime's global 500ms resize
  // suppression as `now + 500`. Released in one synchronous pass they share a
  // single window; trickling in one IPC at a time they keep pushing it forward.
  ipcMain.handle(
    'terminalPreview:detach',
    (event, args: { ptyIds?: unknown; surfaceId?: unknown }): void => {
      const surfaceId = surfaceIdOf(args?.surfaceId)
      if (
        !isTerminalPreviewRenderer(event.sender) ||
        !Array.isArray(args?.ptyIds) ||
        surfaceId === null
      ) {
        return
      }
      for (const ptyId of args.ptyIds.slice(0, DETACH_BATCH_MAX)) {
        if (!isValidPtyId(ptyId)) {
          continue
        }
        surfaces.stream(event.sender.id, ptyId, surfaceId)?.dispose()
        surfaces.releaseClaim(event.sender.id, ptyId, surfaceId)
      }
    }
  )
}
