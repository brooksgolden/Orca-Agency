import type { IBufferLine } from '@xterm/xterm'
import {
  getTerminalPathExistsCacheKey,
  readTerminalPathExistence,
  type TerminalPathExistsCache
} from './terminal-path-exists-cache'
import { findTerminalFileLinksAtBufferPosition } from '../../../../shared/terminal-link-buffer-hit-testing'
import { terminalLogicalLinkHasOscLink } from '../../../../shared/terminal-osc-link-cells'
import {
  getTerminalFileContext,
  mapTerminalFilePath,
  openDetectedFilePath,
  terminalLinkWslDistro,
  type FileOpenFailure,
  type TerminalFileContext
} from './terminal-file-open-routing'
import { reserveDetectedFilePathOpenTurn } from './terminal-file-open-turn'
import {
  fileLinkTargetExists,
  mayCheckFileLinkTargetUnprompted,
  resolveFileLinkTarget,
  type FileLinkHost,
  type FileLinkTarget
} from './terminal-file-link-target'
import {
  collectPriorTerminalFileLinkAnchors,
  contextualFileLinkTargets,
  readRecentTerminalPathExistence
} from './terminal-relative-file-link-context'
import { createTerminalPathExistenceBatch } from './terminal-path-existence-batch'
import { runtimeTargetEnvironmentId } from '@/runtime/runtime-client-target'
import { getRuntimeEnvironmentRevision } from '@/runtime/runtime-environment-revision'
import { isRemoteRuntimeFileOperation } from '@/runtime/runtime-file-routing'

type FileLinkHitTestDeps = {
  startupCwd: string
  terminalHomePath?: string | null
  worktreeId: string
  worktreePath: string
  runtimeEnvironmentId?: string | null
  wslDistro?: string | null
  terminalHandle?: string | null
  pathExistsCache?: TerminalPathExistsCache
  openWithSystemDefault?: boolean
  sourceTabId?: string | null
  /** Tells the user why a click opened nothing; skipped once a later click supersedes it. */
  onOpenFailure?: (absolutePath: string, failure: FileOpenFailure) => void
}

type ClickedFileLink = FileLinkTarget & {
  pathText: string
  cachedExists: boolean | undefined
  hasOscLink: boolean
  /** Opens only once the host has found its file. */
  guess: boolean
}

// Why: a slow probe from an earlier click must not open its file after a later click.
let latestClickGesture = 0

export function openFilePathLinkAtBufferPosition(
  buffer: { getLine(y: number): IBufferLine | undefined },
  position: { x: number; y: number },
  terminalColumns: number,
  deps: FileLinkHitTestDeps
): boolean {
  const gesture = ++latestClickGesture
  const host: FileLinkHost = { ...deps, cwd: deps.startupCwd, homePath: deps.terminalHomePath }
  const readings = findTerminalFileLinksAtBufferPosition(buffer, position, terminalColumns)
  const links: ClickedFileLink[] = []
  for (const [parsed, guess] of [
    ...readings.links.map((link) => [link, false] as const),
    ...readings.guesses.map((link) => [link, true] as const)
  ]) {
    const target = resolveFileLinkTarget(parsed, host)
    const cachedExists =
      target && deps.pathExistsCache
        ? readTerminalPathExistence(deps.pathExistsCache, target.cacheKey)
        : undefined
    // Why: a guess the host may not be asked about (an external share) can never be confirmed.
    if (
      !target ||
      (guess && cachedExists !== true && !mayCheckFileLinkTargetUnprompted(target, host))
    ) {
      continue
    }
    links.push({
      ...target,
      pathText: parsed.pathText,
      cachedExists,
      guess,
      hasOscLink: terminalLogicalLinkHasOscLink(
        buffer,
        parsed.logicalLine,
        parsed.startIndex,
        parsed.endIndex
      )
    })
  }

  // Why: only a written path or a confirmed guess takes the click; prose beside a path stays ordinary text.
  if (!links.some((link) => !link.guess || link.cachedExists === true)) {
    return false
  }
  // Why: a failure names the path the user sees, never a guess.
  const shown = shortestPath(links.filter((link) => !link.guess))
  const open = (link: ClickedFileLink, verified = link.cachedExists === true): void => {
    const { onOpenFailure } = deps
    // Why: a bare dotted word (`console.log`, `example.com`) is not a claim that a file exists.
    const reportsFailure =
      onOpenFailure && (verified || link.isKnownWorktreeRoot || /[\\/]/.test(link.pathText))
    const reportedPath =
      verified || link.isKnownWorktreeRoot || !shown ? link.absolutePath : shown.absolutePath
    openDetectedFilePath(link.absolutePath, link.line, link.column, {
      ...deps,
      openWithSystemDefault: deps.openWithSystemDefault === true,
      onOpenFailure: reportsFailure ? (failure) => onOpenFailure(reportedPath, failure) : undefined
    })
  }
  // Why: Agency resolves a relative `dir/file` against an earlier absolute path in the buffer. Such a
  // reading opens only when both sides were verified by a fresh probe, and never over a settled hit.
  const contextual = contextualVerifiedLink(buffer, position.y, links, deps)
  if (
    contextual === null &&
    !links.some((link) => link.cachedExists === true || link.isKnownWorktreeRoot)
  ) {
    return false
  }
  if (contextual && !links.some((link) => link.cachedExists === true || link.isKnownWorktreeRoot)) {
    open(contextual, true)
    return true
  }
  // Never stat external shares unprompted; open the path as written and let the host resolve it.
  const settled = (link: ClickedFileLink): boolean =>
    link.cachedExists === true ||
    link.isKnownWorktreeRoot ||
    (link.cachedExists === undefined && !mayCheckFileLinkTargetUnprompted(link, host))
  const unique = links.filter(
    (link, index) => links.findIndex((other) => other.cacheKey === link.cacheKey) === index
  )
  const best = longestPath(unique.filter(settled))
  // Why longer only: a cached `foo.ts` must not win over an unchecked hard-wrapped `foo.ts.map`.
  const toProbe = unique.filter(
    (link) =>
      link.cachedExists === undefined &&
      !settled(link) &&
      (!best || link.pathText.length > best.pathText.length)
  )
  // Why the visible path last: a click on a missing path still says so. An OSC 8 hyperlink there is xterm's to open.
  const visible = shown && !shown.hasOscLink && /[\\/]/.test(shown.pathText) ? shown : undefined
  if (toProbe.length === 0 || (!best && toProbe.length === 1 && !toProbe[0].guess)) {
    const link = best ?? toProbe[0] ?? visible
    if (link) {
      open(link)
    }
    return link !== undefined
  }

  // Probe before choosing a longer hard-wrap or spaced reading; otherwise a bad join can hide the real path.
  const isLatestOpen = reserveDetectedFilePathOpenTurn()
  const clickedHost = fileHostFingerprint(toProbe[0].fileContext)
  void probeClickedFileLinks(toProbe, deps).then((existing) => {
    // A changed host/pairing cannot authorize opening a same-named file on the new host.
    const currentHost = fileHostFingerprint(
      getTerminalFileContext(deps.worktreeId, deps.worktreePath, deps.runtimeEnvironmentId)
    )
    if (gesture !== latestClickGesture || !isLatestOpen() || currentHost !== clickedHost) {
      return
    }
    const found = longestPath(existing)
    // Without a verified reading, opening the shortest unchecked path reports the real failure.
    const link = found ?? best ?? shortestPath(toProbe.filter((link) => !link.guess)) ?? visible
    if (link) {
      open(link, link === found || link.cachedExists === true)
    }
  })
  return true
}

/** The single relative reading whose anchor and target both verified; ambiguous or unproven yields none. */
function contextualVerifiedLink(
  buffer: { getLine(y: number): IBufferLine | undefined },
  bufferLineNumber: number,
  candidates: ClickedFileLink[],
  deps: FileLinkHitTestDeps
): ClickedFileLink | null | undefined {
  const cache = deps.pathExistsCache
  if (
    !cache ||
    collectPriorTerminalFileLinkAnchors(
      buffer,
      bufferLineNumber,
      deps.startupCwd,
      deps.terminalHomePath
    ).length === 0
  ) {
    return undefined
  }
  let hasContextualTargets = false
  const verified = candidates.flatMap((candidate) => {
    if (!/^[\p{L}\p{N}._-]+[\\/]/u.test(candidate.pathText)) {
      return []
    }
    const targets = contextualFileLinkTargets(
      buffer,
      bufferLineNumber,
      candidate.pathText,
      deps.startupCwd,
      deps.terminalHomePath
    )
    hasContextualTargets ||= targets.length > 0
    const cacheValue = (path: string): boolean | undefined => {
      const mapped = mapTerminalFilePath(
        path,
        deps.worktreePath,
        terminalLinkWslDistro(deps.wslDistro, deps.runtimeEnvironmentId)
      )
      return readRecentTerminalPathExistence(
        cache,
        getTerminalPathExistsCacheKey({
          absolutePath: mapped,
          connectionId: candidate.fileContext.connectionId,
          isRemoteRuntimePath: isRemoteRuntimeFileOperation(candidate.fileContext, mapped),
          runtimeEnvironmentId: deps.runtimeEnvironmentId
        })
      )
    }
    if (
      targets.some(
        ({ anchorPath, absolutePath }) =>
          cacheValue(anchorPath) === undefined || cacheValue(absolutePath) === undefined
      )
    ) {
      return []
    }
    const provenTargets = targets.filter(
      ({ anchorPath, absolutePath }) =>
        cacheValue(anchorPath) === true && cacheValue(absolutePath) === true
    )
    const paths = new Set(provenTargets.map(({ absolutePath }) => absolutePath))
    if (paths.size !== 1) {
      return []
    }
    const absolutePath = mapTerminalFilePath(
      provenTargets[0].absolutePath,
      deps.worktreePath,
      terminalLinkWslDistro(deps.wslDistro, deps.runtimeEnvironmentId)
    )
    return [{ ...candidate, absolutePath }]
  })
  return verified.length === 1 ? verified[0] : hasContextualTargets ? null : undefined
}

function fileHostFingerprint(context: TerminalFileContext): string {
  const environmentId = runtimeTargetEnvironmentId(context.target)
  return JSON.stringify([context, environmentId && getRuntimeEnvironmentRevision(environmentId)])
}

async function probeClickedFileLinks(
  links: ClickedFileLink[],
  deps: FileLinkHitTestDeps
): Promise<ClickedFileLink[]> {
  const pathExists = createTerminalPathExistenceBatch()
  const cache: TerminalPathExistsCache = deps.pathExistsCache ?? new Map()
  const exists = await Promise.all(
    links.map((link) =>
      // Why: a guess the host cannot answer must not hide a sibling.
      fileLinkTargetExists(link, cache, pathExists, deps.terminalHandle).catch(() => false)
    )
  )
  return links.filter((_, index) => exists[index])
}

function shortestPath(links: ClickedFileLink[]): ClickedFileLink | undefined {
  return links.reduce<ClickedFileLink | undefined>(
    (best, link) => (!best || link.pathText.length < best.pathText.length ? link : best),
    undefined
  )
}

function longestPath(links: ClickedFileLink[]): ClickedFileLink | undefined {
  return links.reduce<ClickedFileLink | undefined>(
    (best, link) => (!best || link.pathText.length > best.pathText.length ? link : best),
    undefined
  )
}
