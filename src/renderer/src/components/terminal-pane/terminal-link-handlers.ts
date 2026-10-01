import {
  preferLongestNonOverlappingLinks,
  type ProvidedFileLink
} from './terminal-file-link-overlap'
import { createTerminalPathExistenceBatch } from './terminal-path-existence-batch'
import type { IDisposable, ILinkProvider, Terminal } from '@xterm/xterm'
import { extractTerminalFileLinkCandidates, extractTerminalFileLinks } from '@/lib/terminal-links'
import {
  buildCandidateLogicalLinesForBufferPosition,
  dedupeLogicalLines,
  openFilePathLinkAtBufferPosition
} from './terminal-file-link-hit-testing'
import {
  isHtmlFilePath,
  getTerminalFileContext,
  shouldOpenTerminalFileWithSystemDefault
} from './terminal-file-open-routing'
import {
  buildHardWrappedPathLogicalLineCandidates,
  buildWrappedLogicalLine,
  rangeForParsedFileLink
} from './wrapped-terminal-link-ranges'
import {
  getTerminalHtmlFileOpenHint,
  getTerminalOrcaFileOpenHint,
  getTerminalWorktreePathOpenHint,
  getTerminalFileOpenHint,
  getTerminalUrlOpenHint
} from './terminal-link-open-hints'
import { resolveKnownWorktreeRootPathLink } from './terminal-worktree-path-link'
import { isTerminalLinkDirectActivation } from './terminal-link-activation'
import { getTerminalBufferPositionForMouseEvent } from './terminal-mouse-buffer-position'
import type { TerminalLinkActionContext } from './terminal-link-action-request'
import { handleTerminalFileLink } from './terminal-file-link-actions'
import {
  collectPriorTerminalFileLinkAnchors,
  resolveExistingTerminalFileLinkPath
} from './terminal-relative-file-link-context'

export { openDetectedFilePath } from './terminal-file-open-routing'
export { mapTerminalFilePath } from './terminal-file-open-routing'
export { openFilePathLinkAtBufferPosition } from './terminal-file-link-hit-testing'
export { getTerminalFileOpenHint, getTerminalHtmlFileOpenHint, getTerminalUrlOpenHint }
export { isTerminalLinkActivation } from './terminal-link-activation'

export type LinkHandlerDeps = {
  worktreeId: string
  worktreePath: string
  startupCwd: string
  getPaneLinkCwd?: (paneId: number) => string | null
  managerRef: React.RefObject<{
    getPanes: () => { id: number; terminal: Pick<Terminal, 'buffer' | 'clearSelection'> }[]
  } | null>
  linkProviderDisposablesRef: React.RefObject<Map<number, IDisposable>>
  pathExistsCache: Map<string, boolean>
  runtimeEnvironmentId?: string | null
  terminalHomePath?: string | null
  wslDistro?: string | null
  getRuntimeEnvironmentIdForPane?: (paneId: number) => string | null
  getLinkActionContext?: (paneId: number) => TerminalLinkActionContext | null
  isCurrent?: () => boolean
}

export function createFilePathLinkProvider(
  paneId: number,
  deps: LinkHandlerDeps,
  linkTooltip: HTMLElement,
  openLinkHint: string
): ILinkProvider {
  const { startupCwd, managerRef, pathExistsCache, worktreeId, worktreePath } = deps
  return {
    provideLinks: (bufferLineNumber, callback) => {
      if (deps.isCurrent?.() === false) {
        callback(undefined)
        return
      }
      const pane = managerRef.current?.getPanes().find((candidate) => candidate.id === paneId)
      if (!pane) {
        callback(undefined)
        return
      }

      const buffer = pane.terminal.buffer.active
      const softWrappedLogicalLine = buildWrappedLogicalLine(buffer, bufferLineNumber)
      const logicalLines = dedupeLogicalLines([
        ...buildHardWrappedPathLogicalLineCandidates(buffer, bufferLineNumber),
        ...(softWrappedLogicalLine ? [softWrappedLogicalLine] : [])
      ])
      if (logicalLines.every((logicalLine) => !logicalLine.text)) {
        callback(undefined)
        return
      }

      if (
        logicalLines.every((logicalLine) => extractTerminalFileLinks(logicalLine.text).length === 0)
      ) {
        callback(undefined)
        return
      }

      const pathExists = createTerminalPathExistenceBatch()
      const paneLinkCwd = deps.getPaneLinkCwd?.(paneId) ?? startupCwd
      let priorAnchors: string[] | undefined
      const getPriorAnchors = (): string[] =>
        (priorAnchors ??= collectPriorTerminalFileLinkAnchors(
          buffer,
          bufferLineNumber,
          paneLinkCwd,
          deps.terminalHomePath
        ))
      void Promise.all(
        logicalLines.flatMap((logicalLine) =>
          extractTerminalFileLinkCandidates(logicalLine.text).map(
            async (parsed): Promise<ProvidedFileLink | null> => {
              const runtimeEnvironmentId =
                deps.getRuntimeEnvironmentIdForPane?.(paneId) ?? deps.runtimeEnvironmentId ?? null
              const range = rangeForParsedFileLink(logicalLine, parsed.startIndex, parsed.endIndex)
              if (!range) {
                return null
              }
              const fileContext = getTerminalFileContext(
                worktreeId,
                worktreePath,
                runtimeEnvironmentId
              )
              const mappedPath = await resolveExistingTerminalFileLinkPath({
                parsed,
                buffer,
                bufferLineNumber,
                cwd: paneLinkCwd,
                homePath: deps.terminalHomePath,
                worktreePath,
                wslDistro: deps.wslDistro,
                runtimeEnvironmentId,
                fileContext,
                pathExistsCache,
                pathExists,
                getPriorAnchors
              })
              if (!mappedPath) {
                return null
              }
              const worktreeRootLink = resolveKnownWorktreeRootPathLink(mappedPath)

              return {
                logicalLine,
                link: {
                  range,
                  text: parsed.displayText,
                  activate: (event) => {
                    if (deps.isCurrent?.() === false) {
                      return
                    }
                    if (
                      handleTerminalFileLink(
                        mappedPath,
                        parsed.line,
                        parsed.column,
                        event,
                        {
                          worktreeId,
                          worktreePath,
                          runtimeEnvironmentId,
                          wslDistro: deps.wslDistro
                        },
                        deps.getLinkActionContext?.(paneId)
                      )
                    ) {
                      pane.terminal.clearSelection?.()
                    }
                  },
                  hover: () => {
                    // Why: only local paths can offer the Shift+modifier system
                    // default escape hatch; remote paths may not exist locally.
                    const canOpenWithSystemDefault = shouldOpenTerminalFileWithSystemDefault(
                      fileContext,
                      mappedPath
                    )
                    const showActions = deps.getLinkActionContext
                      ? deps.getLinkActionContext(paneId) !== null
                      : true
                    const hint = worktreeRootLink
                      ? getTerminalWorktreePathOpenHint(canOpenWithSystemDefault, showActions)
                      : canOpenWithSystemDefault
                        ? isHtmlFilePath(mappedPath)
                          ? getTerminalHtmlFileOpenHint(showActions)
                          : showActions
                            ? openLinkHint
                            : getTerminalFileOpenHint(false)
                        : getTerminalOrcaFileOpenHint(showActions)
                    linkTooltip.textContent = `${mappedPath} (${hint})`
                    linkTooltip.style.display = ''
                  },
                  leave: () => {
                    linkTooltip.style.display = 'none'
                  }
                }
              }
            }
          )
        )
      )
        .then(
          (resolvedLinks) => {
            if (deps.isCurrent?.() === false) {
              callback(undefined)
              return
            }
            const latestFingerprints = new Set(
              buildCandidateLogicalLinesForBufferPosition(buffer, bufferLineNumber).map(
                (logicalLine) => logicalLine.fingerprint
              )
            )
            const providedLinks = resolvedLinks.filter(
              (link): link is ProvidedFileLink => link !== null
            )
            const links = preferLongestNonOverlappingLinks(providedLinks)
              .filter(({ logicalLine }) => latestFingerprints.has(logicalLine.fingerprint))
              .map(({ link }) => link)
            if (providedLinks.length > 0 && links.length === 0) {
              return
            }
            callback(links.length > 0 ? links : undefined)
          },
          () => {
            // Why: remote probes reject during SSH teardown; using the rejection
            // arm avoids treating a consumer callback failure as a probe failure.
            callback(undefined)
          }
        )
        .catch(() => {
          // Link discovery is best-effort; a stale xterm callback must not
          // recreate the unhandled rejection this path is meant to contain.
        })
    }
  }
}

export function installFilePathLinkClickFallback(
  paneId: number,
  terminal: Terminal,
  deps: LinkHandlerDeps
): IDisposable {
  const mouseUpListenerOptions = { capture: true }
  const handleMouseUp = (event: MouseEvent): void => {
    if (deps.isCurrent?.() === false || !isTerminalLinkDirectActivation(event)) {
      return
    }

    const position = getTerminalBufferPositionForMouseEvent(terminal, event)
    if (!position) {
      return
    }
    const runtimeEnvironmentId =
      deps.getRuntimeEnvironmentIdForPane?.(paneId) ?? deps.runtimeEnvironmentId ?? null
    // Why: xterm can show a wrapped provider link as active while still missing
    // activation for the clicked wrapped row. Always retry file-path hit testing
    // on modifier mouseup; openDetectedFilePath coalesces duplicate opens.
    const opened = openFilePathLinkAtBufferPosition(
      terminal.buffer.active,
      position,
      terminal.cols,
      {
        startupCwd: deps.getPaneLinkCwd?.(paneId) ?? deps.startupCwd,
        terminalHomePath: deps.terminalHomePath,
        worktreeId: deps.worktreeId,
        worktreePath: deps.worktreePath,
        runtimeEnvironmentId,
        wslDistro: deps.wslDistro,
        pathExistsCache: deps.pathExistsCache,
        openWithSystemDefault: Boolean(event.shiftKey)
      }
    )
    if (opened) {
      event.preventDefault()
      event.stopPropagation()
      terminal.clearSelection()
    }
  }

  const terminalElement = terminal.element
  terminalElement?.addEventListener('mouseup', handleMouseUp, mouseUpListenerOptions)
  return {
    dispose: () => {
      terminalElement?.removeEventListener('mouseup', handleMouseUp, mouseUpListenerOptions)
    }
  }
}
