import type { IBufferLine, IBufferRange } from '@xterm/xterm'
import { extractTerminalFileLinkCandidates, resolveTerminalFileLink } from '@/lib/terminal-links'
import { normalizeAbsolutePath } from '@/lib/terminal-path-normalization'
import { isRemoteRuntimeFileOperation } from '@/runtime/runtime-file-client'
import {
  getTerminalFileContext,
  mapTerminalFilePath,
  openDetectedFilePath,
  terminalLinkWslDistro
} from './terminal-file-open-routing'
import {
  getTerminalPathExistsCacheKey,
  wasTerminalPathExistsCacheRecentlyProbed
} from './terminal-path-exists-cache'
import { resolveKnownWorktreeRootPathLink } from './terminal-worktree-path-link'
import { contextualFileLinkTargets } from './terminal-relative-file-link-context'
import {
  buildHardWrappedPathLogicalLineCandidates,
  buildWrappedLogicalLine,
  rangeForParsedFileLink,
  type WrappedLogicalLine
} from './wrapped-terminal-link-ranges'

type FileLinkHitTestDeps = {
  startupCwd: string
  terminalHomePath?: string | null
  worktreeId: string
  worktreePath: string
  runtimeEnvironmentId?: string | null
  wslDistro?: string | null
  pathExistsCache?: Map<string, boolean>
  openWithSystemDefault?: boolean
}

export function openFilePathLinkAtBufferPosition(
  buffer: { getLine(y: number): IBufferLine | undefined },
  position: { x: number; y: number },
  terminalColumns: number,
  deps: FileLinkHitTestDeps
): boolean {
  const logicalLines = buildCandidateLogicalLinesForBufferPosition(buffer, position.y)
  if (logicalLines.length === 0) {
    return false
  }

  for (const logicalLine of logicalLines) {
    const matches: {
      absolutePath: string
      line: number | null
      column: number | null
      pathText: string
      cachedExists: boolean | undefined
      isKnownWorktreeRoot: boolean
    }[] = []
    for (const parsed of extractTerminalFileLinkCandidates(logicalLine.text)) {
      const resolved = deps.startupCwd
        ? resolveTerminalFileLink(parsed, deps.startupCwd, deps.terminalHomePath)
        : null
      if (!resolved) {
        continue
      }
      const range = rangeForParsedFileLink(logicalLine, parsed.startIndex, parsed.endIndex)
      if (!range || !rangeContainsBufferPosition(range, position, terminalColumns)) {
        continue
      }
      const fileContext = getTerminalFileContext(
        deps.worktreeId,
        deps.worktreePath,
        deps.runtimeEnvironmentId
      )
      const mappedPath = mapTerminalFilePath(
        resolved.absolutePath,
        deps.worktreePath,
        terminalLinkWslDistro(deps.wslDistro, deps.runtimeEnvironmentId)
      )
      const cacheKey = (path: string): string =>
        getTerminalPathExistsCacheKey({
          absolutePath: path,
          connectionId: fileContext.connectionId,
          isRemoteRuntimePath: isRemoteRuntimeFileOperation(fileContext, path),
          runtimeEnvironmentId: deps.runtimeEnvironmentId
        })
      const cachedExists = (path: string): boolean | undefined =>
        deps.pathExistsCache?.get(cacheKey(path))
      const recentlyProbed = (path: string): boolean =>
        wasTerminalPathExistsCacheRecentlyProbed(deps.pathExistsCache, cacheKey(path))
      const isKnownWorktreeRoot = Boolean(resolveKnownWorktreeRootPathLink(mappedPath))
      if (/[\\/]$/.test(parsed.pathText) && !isKnownWorktreeRoot) {
        continue
      }
      const contextual = contextualFileLinkTargets(
        buffer,
        position.y,
        parsed.pathText,
        deps.startupCwd,
        deps.terminalHomePath
      )
      const directExists = cachedExists(mappedPath)
      if (
        isKnownWorktreeRoot ||
        directExists === true ||
        (directExists === undefined && contextual.length === 0)
      ) {
        matches.push({
          absolutePath: mappedPath,
          line: resolved.line,
          column: resolved.column,
          pathText: parsed.pathText,
          cachedExists: directExists,
          isKnownWorktreeRoot
        })
      }
      if (
        isKnownWorktreeRoot ||
        directExists !== false ||
        contextual.length === 0 ||
        !recentlyProbed(mappedPath)
      ) {
        continue
      }
      const verified = new Map<string, string>()
      let pending = false
      for (const { anchorPath, absolutePath } of contextual) {
        const anchor = mapTerminalFilePath(
          anchorPath,
          deps.worktreePath,
          terminalLinkWslDistro(deps.wslDistro, deps.runtimeEnvironmentId)
        )
        const target = mapTerminalFilePath(
          absolutePath,
          deps.worktreePath,
          terminalLinkWslDistro(deps.wslDistro, deps.runtimeEnvironmentId)
        )
        const anchorExists = cachedExists(anchor)
        if (anchorExists === false) {
          if (!recentlyProbed(anchor)) {
            pending = true
          }
          continue
        }
        const targetExists = cachedExists(target)
        if (
          anchorExists === undefined ||
          targetExists === undefined ||
          !recentlyProbed(anchor) ||
          !recentlyProbed(target)
        ) {
          pending = true
        } else if (anchorExists && targetExists) {
          const key = normalizeAbsolutePath(target)?.comparisonKey
          if (key) {
            verified.set(key, target)
          }
        }
      }
      if (!pending && verified.size === 1) {
        matches.push({
          absolutePath: [...verified.values()][0],
          line: resolved.line,
          column: resolved.column,
          pathText: parsed.pathText,
          cachedExists: true,
          isKnownWorktreeRoot: false
        })
      }
    }

    const cachedMatch = matches
      .filter((match) => match.cachedExists)
      .sort((a, b) => b.pathText.length - a.pathText.length)[0]
    const knownWorktreeRootMatch = matches
      .filter((match) => match.isKnownWorktreeRoot)
      .sort((a, b) => b.pathText.length - a.pathText.length)[0]
    const uncachedMatch = matches.find((match) => match.cachedExists !== false)
    const match = cachedMatch ?? knownWorktreeRootMatch ?? uncachedMatch
    if (match) {
      openDetectedFilePath(match.absolutePath, match.line, match.column, {
        ...deps,
        openWithSystemDefault: deps.openWithSystemDefault === true
      })
      return true
    }
  }

  return false
}

export function buildCandidateLogicalLinesForBufferPosition(
  buffer: { getLine(y: number): IBufferLine | undefined },
  bufferLineNumber: number
): WrappedLogicalLine[] {
  const hardWrappedCandidates = buildHardWrappedPathLogicalLineCandidates(buffer, bufferLineNumber)
  const softWrappedLogicalLine = buildWrappedLogicalLine(buffer, bufferLineNumber)
  const candidates = softWrappedLogicalLine
    ? [...hardWrappedCandidates, softWrappedLogicalLine]
    : hardWrappedCandidates
  return dedupeLogicalLines(candidates)
}

export function dedupeLogicalLines(logicalLines: WrappedLogicalLine[]): WrappedLogicalLine[] {
  const seen = new Set<string>()
  return logicalLines.filter((logicalLine) => {
    if (seen.has(logicalLine.fingerprint)) {
      return false
    }
    seen.add(logicalLine.fingerprint)
    return true
  })
}

function rangeContainsBufferPosition(
  range: IBufferRange,
  position: { x: number; y: number },
  terminalColumns: number
): boolean {
  const lower = range.start.y * terminalColumns + range.start.x
  const upper = range.end.y * terminalColumns + range.end.x
  const current = position.y * terminalColumns + position.x
  return lower <= current && current <= upper
}
