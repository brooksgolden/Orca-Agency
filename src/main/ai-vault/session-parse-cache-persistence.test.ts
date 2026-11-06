/* eslint-disable max-lines -- Why: The persistence suite exercises cache recovery, corruption, and filesystem lifecycle against one shared fixture. */
import { existsSync } from 'node:fs'
import { appendFile, mkdir, mkdtemp, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises'
import * as fsPromises from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SyncDatabase from '../sqlite/sync-database'
import type { AiVaultSession } from '../../shared/ai-vault-types'
import {
  configureSessionParseCachePersistence,
  flushSessionParseCachePersist,
  getSessionParseCachePersistenceOptions,
  initSessionParseCachePersistence,
  resetSessionParseCachePersistenceForTests
} from './session-parse-cache-persistence'
import {
  SESSION_PARSE_CACHE_SCHEMA_VERSION,
  SessionParseCacheDatabase
} from './session-parse-cache-database'
import { scanAiVaultSessions } from './session-scanner'
import {
  createSessionParseStats,
  invalidateSessionParseCacheEntry,
  parseAgentSessionFileCached,
  resetSessionParseCacheForTests,
  type SessionParseStats
} from './session-scanner-parse-cache'
import type * as ParseCacheModule from './session-scanner-parse-cache'
import {
  getSessionParseCacheEntry,
  storeSessionParseCacheEntry,
  storeSessionScopeCwd,
  type PersistedSessionParseCacheEntry,
  type SessionScopeCwdStamp
} from './session-parse-cache-store'
import type { SessionSidecarObservation } from './session-sidecar-stat'
import { isolatedScanRoots } from './session-scanner-test-fixtures'
import { parseClaudeSessionFile } from './session-scanner-primary-parsers'
import type { FileWithMtime, SessionFileCandidate } from './session-scanner-types'

const hooks = vi.hoisted(() => {
  const state: { beforeParse: (() => Promise<void>) | null } = { beforeParse: null }
  return state
})

// Preserve real I/O while measuring whether an uninitialized cache touches disk.
vi.mock('node:fs/promises', { spy: true })
vi.mock('./session-scanner-parse-cache', async (importOriginal) => {
  const actual = await importOriginal<typeof ParseCacheModule>()
  return {
    ...actual,
    parseListedSessionFile: async (...args: Parameters<typeof actual.parseListedSessionFile>) => {
      await hooks.beforeParse?.()
      return actual.parseListedSessionFile(...args)
    }
  }
})

const APP_VERSION = '1.2.3-test'
const DAY_MS = 24 * 60 * 60_000

let tempRoots: string[] = []

beforeEach(() => {
  resetSessionParseCacheForTests()
  resetSessionParseCachePersistenceForTests()
  hooks.beforeParse = null
})

afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  resetSessionParseCachePersistenceForTests()
  await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })))
  tempRoots = []
})

async function makeTempDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'orca-parse-cache-persist-'))
  tempRoots.push(root)
  return root
}

async function claudeCandidate(path: string): Promise<SessionFileCandidate> {
  const fileStat = await stat(path)
  const file: FileWithMtime = {
    path,
    mtimeMs: fileStat.mtimeMs,
    modifiedAt: fileStat.mtime.toISOString(),
    sizeBytes: fileStat.size
  }
  return { agent: 'claude', file, codexHome: null }
}

function userRecord(index: number, text: string): string {
  return JSON.stringify({
    type: 'user',
    sessionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    timestamp: new Date(1740000000000 + index * 60_000).toISOString(),
    cwd: '/repo/app',
    gitBranch: 'main',
    message: { role: 'user', content: text }
  })
}

function assistantRecord(index: number, text: string): string {
  return JSON.stringify({
    type: 'assistant',
    sessionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    timestamp: new Date(1740000000000 + index * 60_000).toISOString(),
    message: {
      role: 'assistant',
      model: 'claude-fable-5',
      content: [{ type: 'text', text }],
      usage: { input_tokens: 100, output_tokens: 40 }
    }
  })
}

async function writeTranscript(
  root: string,
  name = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
): Promise<string> {
  const path = join(root, `${name}.jsonl`)
  await writeFile(path, `${userRecord(0, 'first question')}\n${assistantRecord(1, 'answer')}\n`)
  return path
}

async function parse(path: string): Promise<SessionParseStats> {
  const stats = createSessionParseStats()
  await parseAgentSessionFileCached(await claudeCandidate(path), process.platform, stats)
  return stats
}

function simulateRestart(cacheFile: string, appVersion = APP_VERSION): void {
  resetSessionParseCacheForTests()
  resetSessionParseCachePersistenceForTests()
  initSessionParseCachePersistence({ filePath: cacheFile, appVersion })
}

function databaseRows(cacheFile: string): { path: string; seen_at: number }[] {
  const db = new SyncDatabase(join(dirname(cacheFile), 'session-parse-cache.sqlite'))
  try {
    return db
      .prepare('SELECT path, seen_at FROM rows ORDER BY path')
      .all()
      .map((row) => ({ path: String(row.path), seen_at: Number(row.seen_at) }))
  } finally {
    db.close()
  }
}

type LegacyRow = [string, PersistedSessionParseCacheEntry]

// Opening the cold tier runs the legacy JSON import, so reading any path loads it.
async function ensureSessionParseCacheLoaded(): Promise<void> {
  getSessionParseCacheEntry(join(tmpdir(), 'orca-parse-cache-load-probe.jsonl'))
}

function legacyRow(candidate: SessionFileCandidate, session: AiVaultSession | null): LegacyRow {
  return [
    candidate.file.path,
    {
      mtimeMs: candidate.file.mtimeMs,
      sizeBytes: candidate.file.sizeBytes ?? null,
      platform: process.platform,
      session
    }
  ]
}

function legacyRowFrom(path: string): LegacyRow {
  const entry = getSessionParseCacheEntry(path)
  if (!entry) {
    throw new Error(`Expected a cached entry for ${path}`)
  }
  return [
    path,
    {
      mtimeMs: entry.mtimeMs,
      sizeBytes: entry.sizeBytes,
      platform: entry.platform,
      session: entry.session
    }
  ]
}

// Writes the pre-SQLite JSON file that the database imports on first open.
async function writeLegacyCache(
  cacheFile: string,
  schemaVersion: number,
  entries: LegacyRow[]
): Promise<void> {
  await writeFile(cacheFile, JSON.stringify({ schemaVersion, appVersion: APP_VERSION, entries }))
}

async function parseAndPersist(path: string): Promise<AiVaultSession | null> {
  const session = await parseAgentSessionFileCached(await claudeCandidate(path), process.platform)
  await flushSessionParseCachePersist()
  return session
}

/**
 * Schema 2 dropped the `appVersion` equality gate: a cache written by any
 * release with this schema is now replayed straight into Agent Session
 * History without re-reading the transcript (#17888 — the gate forced a
 * multi-gigabyte cold scan after every update). The cost of that reuse is
 * that nothing else invalidates a stale row, so `SCHEMA_VERSION` is the only
 * remaining compatibility signal and forgetting to bump it ships wrong data.
 *
 * This table is the reminder. Changing the persisted session shape — or the
 * meaning of a field the parsers fill — breaks this `satisfies` and the fix
 * is to bump `SCHEMA_VERSION` in session-parse-cache-database.ts. Schema 6
 * reparses older Claude sessions to classify headless transcripts.
 */
const CACHED_SESSION_FIELDS = {
  id: true,
  executionHostId: true,
  executionHostPlatform: true,
  agent: true,
  sessionId: true,
  title: true,
  cwd: true,
  cwdAliases: true,
  branch: true,
  model: true,
  filePath: true,
  codexHome: true,
  accountHome: true,
  accountWslDistro: true,
  createdAt: true,
  updatedAt: true,
  modifiedAt: true,
  messageCount: true,
  totalTokens: true,
  previewMessages: true,
  isHeadless: true,
  resumedSessionIdPrefix: true,
  lastHumanTurnAt: true,
  previewMessagesTruncated: true,
  antigravityOpeningPrompt: true,
  firstUserPrompt: true,
  lastUserPrompt: true,
  queuedMessageCount: true,
  subagentTranscriptCount: true,
  resumeCommand: true,
  subagent: true,
  structuredSession: true,
  hostPairingRevision: true
} satisfies Record<keyof AiVaultSession, true>

describe('cached session compatibility', () => {
  it('pins the persisted session shape to the current parse-cache schema', () => {
    expect(Object.keys(CACHED_SESSION_FIELDS).length).toBeGreaterThan(0)
  })
})

function setSeenAt(cacheFile: string, path: string, seenAt: number): void {
  const db = new SyncDatabase(join(dirname(cacheFile), 'session-parse-cache.sqlite'))
  db.prepare('UPDATE rows SET seen_at = ? WHERE path = ?').run(seenAt, path)
  db.close()
}

describe('session parse cache persistence', () => {
  it('exposes a copy of the active configuration for background scanners', () => {
    const configured = { filePath: '/tmp/ai-vault-cache.json', appVersion: APP_VERSION }
    configureSessionParseCachePersistence(configured)

    const snapshot = getSessionParseCachePersistenceOptions()

    expect(snapshot).toEqual(configured)
    expect(snapshot).not.toBe(configured)
  })

  it('persists scope rows across chunks and keeps replacements queued during a yield', async () => {
    const root = await makeTempDir()
    const cacheFile = join(root, 'session-parse-cache.json')
    initSessionParseCachePersistence({ filePath: cacheFile, appVersion: APP_VERSION })
    const paths = Array.from({ length: 1_001 }, (_, index) => join(root, `session-${index}`))
    const stamp: SessionScopeCwdStamp = {
      mtimeMs: 1,
      sizeBytes: 10,
      platform: 'linux',
      cwd: '/original'
    }
    for (const path of paths) {
      storeSessionScopeCwd(path, stamp)
    }
    const flushing = flushSessionParseCachePersist()
    const replacement = { ...stamp, mtimeMs: 2, cwd: '/updated' }
    storeSessionScopeCwd(paths[0]!, replacement)
    storeSessionScopeCwd(paths[750]!, replacement)
    await flushing
    resetSessionParseCachePersistenceForTests()
    resetSessionParseCacheForTests()

    const database = new SessionParseCacheDatabase(join(root, 'session-parse-cache.sqlite'))
    try {
      const stored = database.readScopeCwds(paths).found
      expect(stored.size).toBe(paths.length)
      for (const [index, path] of paths.entries()) {
        expect(stored.get(path)?.read).toEqual(index === 0 || index === 750 ? replacement : stamp)
      }
    } finally {
      database.close()
    }
  })

  it('round-trips: a persisted entry is a reused hit after a restart, without reading the transcript', async () => {
    const root = await makeTempDir()
    const cacheFile = join(root, 'vault-state', 'session-parse-cache.json')
    initSessionParseCachePersistence({ filePath: cacheFile, appVersion: APP_VERSION })
    const transcript = await writeTranscript(root)
    const candidate = await claudeCandidate(transcript)
    const stats = createSessionParseStats()
    const first = await parseAgentSessionFileCached(candidate, process.platform, stats)
    expect(stats.fullParses).toBe(1)
    await flushSessionParseCachePersist()

    simulateRestart(cacheFile)
    // Removing the transcript proves the restored hit needs no transcript read.
    await rm(transcript)
    const reusedStats = createSessionParseStats()
    const reused = await parseAgentSessionFileCached(candidate, process.platform, reusedStats)
    expect(reusedStats).toMatchObject({ reused: 1, fullParses: 0, incremental: 0, bytesRead: 0 })
    expect(reused).toEqual(first)
  })

  it('ignores a corrupt cache file and scans cold', async () => {
    const root = await makeTempDir()
    const cacheFile = join(root, 'session-parse-cache.json')
    await writeFile(cacheFile, 'not json {{{')
    initSessionParseCachePersistence({ filePath: cacheFile, appVersion: APP_VERSION })

    const transcript = await writeTranscript(root)
    const stats = await parse(transcript)
    expect(stats.fullParses).toBe(1)
    expect(stats.reused).toBe(0)
  })

  it('ignores a cache file with a mismatched schemaVersion', async () => {
    const root = await makeTempDir()
    const cacheFile = join(root, 'session-parse-cache.json')
    initSessionParseCachePersistence({ filePath: cacheFile, appVersion: APP_VERSION })
    const transcript = await writeTranscript(root)
    const candidate = await claudeCandidate(transcript)
    const session = await parseAgentSessionFileCached(candidate, process.platform)
    await writeLegacyCache(cacheFile, 999, [legacyRow(candidate, session)])

    simulateRestart(cacheFile)
    const stats = await parse(transcript)
    expect(stats.fullParses).toBe(1)
    expect(stats.reused).toBe(0)
  })

  it('rejects the legacy schema 1 cache after parser semantics changed', async () => {
    const root = await makeTempDir()
    const cacheFile = join(root, 'session-parse-cache.json')
    initSessionParseCachePersistence({ filePath: cacheFile, appVersion: APP_VERSION })
    const transcript = await writeTranscript(root)
    const candidate = await claudeCandidate(transcript)
    const session = await parseAgentSessionFileCached(candidate, process.platform)
    await writeLegacyCache(cacheFile, 1, [legacyRow(candidate, session)])

    simulateRestart(cacheFile)
    const stats = await parse(transcript)
    expect(stats.fullParses).toBe(1)
    expect(stats.reused).toBe(0)
  })

  it('invalidates old Codex activity and Claude entrypoint caches', async () => {
    const root = await makeTempDir()
    const cacheFile = join(root, 'session-parse-cache.json')
    initSessionParseCachePersistence({ filePath: cacheFile, appVersion: APP_VERSION })
    const transcript = await writeTranscript(root)
    const candidate = await claudeCandidate(transcript)
    const session = await parseAgentSessionFileCached(candidate, process.platform)
    if (!session) {
      throw new Error('Expected a parsed Claude session')
    }
    const codexPath = join(root, 'codex.jsonl')
    const [, transcriptRow] = legacyRow(candidate, session)
    await writeLegacyCache(cacheFile, 3, [
      [transcript, transcriptRow],
      [codexPath, { ...transcriptRow, session: { ...session, agent: 'codex' } }]
    ])

    simulateRestart(cacheFile)
    await ensureSessionParseCacheLoaded()
    expect(getSessionParseCacheEntry(codexPath)).toBeUndefined()
    expect((await parse(transcript)).fullParses).toBe(1)
  })

  it('reparses older Claude caches to classify headless transcripts', async () => {
    const root = await makeTempDir()
    const cacheFile = join(root, 'session-parse-cache.json')
    const transcript = await writeTranscript(root)
    await appendFile(transcript, `${userRecord(2, 'x'.repeat(70_000))}\n`)
    const conversation = await claudeCandidate(transcript)
    await parseAgentSessionFileCached(conversation, process.platform)

    const launcherId = '8b1a93a0-1576-43df-88ba-5b3e742e8496'
    const launcherPath = join(root, `${launcherId}.jsonl`)
    await writeFile(
      launcherPath,
      `${JSON.stringify({ type: 'last-prompt', sessionId: launcherId })}\n${JSON.stringify({
        type: 'system',
        subtype: 'local_command',
        sessionId: launcherId,
        commandRun: { command: 'resume', args: '' },
        content:
          '<local-command-stdout>Opening "Existing chat", running in the background (170dd324)</local-command-stdout>'
      })}\n`
    )
    const launcher = await claudeCandidate(launcherPath)
    await parseAgentSessionFileCached(launcher, process.platform)
    // Rows as the previous schema wrote them: the headless-classification field is missing.
    const oldCache = [legacyRowFrom(launcherPath), legacyRowFrom(transcript)].map(
      ([path, row]): LegacyRow =>
        path === launcherPath && row.session
          ? [path, { ...row, session: { ...row.session, resumedSessionIdPrefix: undefined } }]
          : [path, row]
    )

    for (const schemaVersion of [3, 4, 5]) {
      await writeLegacyCache(cacheFile, schemaVersion, oldCache)
      simulateRestart(cacheFile)
      await ensureSessionParseCacheLoaded()
      expect(getSessionParseCacheEntry(launcherPath)).toBeUndefined()
      expect(getSessionParseCacheEntry(transcript)).toBeUndefined()

      const launcherStats = createSessionParseStats()
      const parsed = await parseAgentSessionFileCached(launcher, process.platform, launcherStats)
      expect(launcherStats.fullParses).toBe(1)
      expect(parsed?.resumedSessionIdPrefix).toBe('170dd324')
      const conversationStats = createSessionParseStats()
      await parseAgentSessionFileCached(conversation, process.platform, conversationStats)
      expect(conversationStats.fullParses).toBe(1)
    }

    // The imported legacy file is removed, and the current-schema rows reach the database.
    await flushSessionParseCachePersist()
    expect(existsSync(cacheFile)).toBe(false)
    simulateRestart(cacheFile)
    await ensureSessionParseCacheLoaded()
    const launcherReuse = createSessionParseStats()
    expect(
      (await parseAgentSessionFileCached(launcher, process.platform, launcherReuse))
        ?.resumedSessionIdPrefix
    ).toBe('170dd324')
    expect(launcherReuse.reused).toBe(1)
  })

  it('reuses a schema-compatible cache written by a different app version', async () => {
    const root = await makeTempDir()
    const cacheFile = join(root, 'session-parse-cache.json')
    initSessionParseCachePersistence({ filePath: cacheFile, appVersion: APP_VERSION })
    const transcript = await writeTranscript(root)
    const candidate = await claudeCandidate(transcript)
    await parseAndPersist(transcript)

    simulateRestart(cacheFile, '9.9.9-other')
    await ensureSessionParseCacheLoaded()

    // Deleting the transcript proves the cross-version result comes entirely
    // from the schema-compatible cache and performs no transcript read.
    await rm(transcript)
    const stats = createSessionParseStats()
    const session = await parseAgentSessionFileCached(candidate, process.platform, stats)
    expect(session).not.toBeNull()
    expect(stats.reused).toBe(1)
    expect(stats.fullParses).toBe(0)
    expect(stats.bytesRead).toBe(0)
  })

  it('seeding never clobbers a live in-memory entry', async () => {
    const root = await makeTempDir()
    const cacheFile = join(root, 'session-parse-cache.json')
    initSessionParseCachePersistence({ filePath: cacheFile, appVersion: APP_VERSION })
    const transcript = await writeTranscript(root)
    const candidate = await claudeCandidate(transcript)
    const live = await parseAgentSessionFileCached(candidate, process.platform)
    expect(live).not.toBeNull()

    // A stale database row for the same path (session: null marker) arrives after the live parse.
    const database = new SessionParseCacheDatabase(join(root, 'session-parse-cache.sqlite'))
    try {
      database.write([legacyRow(candidate, null)], Date.now(), true)
    } finally {
      database.close()
    }

    const stats = createSessionParseStats()
    const after = await parseAgentSessionFileCached(candidate, process.platform, stats)
    expect(stats.reused).toBe(1)
    expect(after).toBe(live)
  })

  it('falls through to a full parse when a seeded file changed while the app was closed', async () => {
    const root = await makeTempDir()
    const cacheFile = join(root, 'session-parse-cache.json')
    initSessionParseCachePersistence({ filePath: cacheFile, appVersion: APP_VERSION })
    const transcript = await writeTranscript(root)
    await parseAndPersist(transcript)

    simulateRestart(cacheFile)
    await ensureSessionParseCacheLoaded()

    // Grown while "closed": seeded entries have no resume state, so this is a
    // full parse (not incremental) whose result matches a cold parse.
    await appendFile(transcript, `${userRecord(2, 'follow-up')}\n${assistantRecord(3, 'more')}\n`)
    const stats = createSessionParseStats()
    const reparsed = await parseAgentSessionFileCached(
      await claudeCandidate(transcript),
      process.platform,
      stats
    )
    expect(stats.fullParses).toBe(1)
    expect(stats.incremental).toBe(0)
    expect(stats.reused).toBe(0)
    expect(reparsed).toEqual(await parseClaudeSessionFile((await claudeCandidate(transcript)).file))
    expect(reparsed?.messageCount).toBe(4)
  })

  it('performs zero disk IO when never initialized', async () => {
    vi.clearAllMocks()

    await ensureSessionParseCacheLoaded()
    storeSessionParseCacheEntry(join(tmpdir(), 'orca-parse-cache-uninitialized.jsonl'), {
      mtimeMs: 1,
      sizeBytes: 1,
      platform: process.platform,
      session: null,
      resume: null
    })
    await flushSessionParseCachePersist()

    expect(fsPromises.readFile).not.toHaveBeenCalled()
    expect(fsPromises.writeFile).not.toHaveBeenCalled()
    expect(fsPromises.mkdir).not.toHaveBeenCalled()
    expect(fsPromises.rename).not.toHaveBeenCalled()
    expect(fsPromises.rm).not.toHaveBeenCalled()
  })

  it('collapses back-to-back schedules into one write', async () => {
    const root = await makeTempDir()
    const cacheFile = join(root, 'session-parse-cache.json')
    initSessionParseCachePersistence({ filePath: cacheFile, appVersion: APP_VERSION })
    const transcript = await writeTranscript(root)
    // Open the database before counting, so the one-time open is not a write.
    await flushSessionParseCachePersist()
    const write = vi.spyOn(SessionParseCacheDatabase.prototype, 'write')

    await parse(transcript)
    await parse(transcript)
    await flushSessionParseCachePersist()

    expect(write).toHaveBeenCalledOnce()
    expect(databaseRows(cacheFile)).toHaveLength(1)
  })

  it('sweeps orphaned temp files from a prior crashed save on load', async () => {
    const root = await makeTempDir()
    const cacheFile = join(root, 'session-parse-cache.json')
    const orphan = join(root, 'session-parse-cache-12345-99.tmp')
    await writeFile(orphan, '{"half":"written')
    initSessionParseCachePersistence({ filePath: cacheFile, appVersion: APP_VERSION })

    await ensureSessionParseCacheLoaded()
    expect(existsSync(orphan)).toBe(false)
  })

  it('scanAiVaultSessions reads the database and writes after parsing', async () => {
    const root = await makeTempDir()
    const cacheFile = join(root, 'session-parse-cache.json')
    initSessionParseCachePersistence({ filePath: cacheFile, appVersion: APP_VERSION })
    const roots = isolatedScanRoots(root)
    const transcript = join(roots.claudeProjectsDir, 'project', 'scan-session.jsonl')
    await mkdir(join(roots.claudeProjectsDir, 'project'), { recursive: true })
    await writeFile(
      transcript,
      `${userRecord(0, 'persisted-scan-marker-AAAA')}\n${assistantRecord(1, 'answer')}\n`
    )
    const pinnedMtime = new Date(1740000000000)
    await utimes(transcript, pinnedMtime, pinnedMtime)

    const first = await scanAiVaultSessions(roots)
    expect(JSON.stringify(first.sessions[0])).toContain('persisted-scan-marker-AAAA')
    await flushSessionParseCachePersist()

    simulateRestart(cacheFile)
    // Same size and mtime but different content distinguishes a persisted hit from a cold parse.
    await writeFile(
      transcript,
      `${userRecord(0, 'persisted-scan-marker-BBBB')}\n${assistantRecord(1, 'answer')}\n`
    )
    await utimes(transcript, pinnedMtime, pinnedMtime)
    const second = await scanAiVaultSessions(roots)
    expect(second.sessions[0]).toEqual(first.sessions[0])
  })

  it('falls through to a full parse when a file changed while the app was closed', async () => {
    const root = await makeTempDir()
    const cacheFile = join(root, 'session-parse-cache.json')
    initSessionParseCachePersistence({ filePath: cacheFile, appVersion: APP_VERSION })
    const transcript = await writeTranscript(root)
    await parse(transcript)
    await flushSessionParseCachePersist()

    simulateRestart(cacheFile)
    // Restored rows lack incremental state; changed transcripts need a full parse.
    await appendFile(transcript, `${userRecord(2, 'follow-up')}\n${assistantRecord(3, 'more')}\n`)
    const stats = createSessionParseStats()
    const reparsed = await parseAgentSessionFileCached(
      await claudeCandidate(transcript),
      process.platform,
      stats
    )
    expect(stats).toMatchObject({ fullParses: 1, incremental: 0, reused: 0 })
    expect(reparsed).toEqual(await parseClaudeSessionFile((await claudeCandidate(transcript)).file))
  })

  it('writes only the rows that changed, and nothing for unchanged hits', async () => {
    const root = await makeTempDir()
    const cacheFile = join(root, 'session-parse-cache.json')
    initSessionParseCachePersistence({ filePath: cacheFile, appVersion: APP_VERSION })
    const transcripts = await Promise.all(
      ['a', 'b', 'c'].map((name) =>
        writeTranscript(root, `${name}aaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee`)
      )
    )
    for (const transcript of transcripts) {
      await parse(transcript)
    }
    await flushSessionParseCachePersist()
    expect(databaseRows(cacheFile)).toHaveLength(3)

    const write = vi.spyOn(SessionParseCacheDatabase.prototype, 'write')
    await appendFile(transcripts[1]!, `${userRecord(2, 'follow-up')}\n`)
    for (const transcript of transcripts) {
      await parse(transcript)
    }
    await flushSessionParseCachePersist()
    expect(write).toHaveBeenCalledOnce()
    expect([...write.mock.calls[0]![0]].map(([path]) => path)).toEqual([transcripts[1]])

    write.mockClear()
    for (const transcript of transcripts) {
      await parse(transcript)
    }
    await flushSessionParseCachePersist()
    expect(write).not.toHaveBeenCalled()
  })

  it('a scan saves the files it finished while it is still running', async () => {
    const root = await makeTempDir()
    const cacheFile = join(root, 'session-parse-cache.json')
    initSessionParseCachePersistence({ filePath: cacheFile, appVersion: APP_VERSION })
    const roots = isolatedScanRoots(root)
    const projectDir = join(roots.claudeProjectsDir, 'project')
    await mkdir(projectDir, { recursive: true })
    for (let index = 0; index < 20; index++) {
      await writeTranscript(
        projectDir,
        `aaaaaaaa-bbbb-4ccc-8ddd-${String(index).padStart(12, '0')}`
      )
    }
    let started = 0
    let release = (): void => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    // A hung eighth parse must not prevent the seven completed rows from persisting.
    hooks.beforeParse = () => (++started === 8 ? held : Promise.resolve())

    const scan = scanAiVaultSessions(roots)
    try {
      await vi.waitFor(() => expect(databaseRows(cacheFile)).toHaveLength(7), {
        timeout: 10_000,
        interval: 100
      })
    } finally {
      release()
    }
    expect((await scan).sessions).toHaveLength(20)
  })

  it('writes at least every 15 s while changes keep arriving', async () => {
    const root = await makeTempDir()
    initSessionParseCachePersistence({
      filePath: join(root, 'session-parse-cache.json'),
      appVersion: APP_VERSION
    })
    const write = vi.spyOn(SessionParseCacheDatabase.prototype, 'write')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    for (let second = 0; second < 20; second++) {
      storeSessionParseCacheEntry('timed', {
        mtimeMs: second,
        sizeBytes: null,
        platform: process.platform,
        session: null,
        resume: null
      })
      await vi.advanceTimersByTimeAsync(1_000)
      if (second === 14) {
        expect(write).toHaveBeenCalledOnce()
      }
    }
    expect(write).toHaveBeenCalledOnce()
    await flushSessionParseCachePersist()
    expect(write).toHaveBeenCalledTimes(2)
  })

  it('imports the old JSON file even when a title lookup reaches the database first', async () => {
    const root = await makeTempDir()
    const cacheFile = join(root, 'session-parse-cache.json')
    const transcript = await writeTranscript(root)
    const candidate = await claudeCandidate(transcript)
    const session = await parseAgentSessionFileCached(candidate, process.platform)
    const legacyRowData = {
      mtimeMs: candidate.file.mtimeMs,
      sizeBytes: candidate.file.sizeBytes,
      platform: process.platform,
      session
    }
    await writeFile(
      cacheFile,
      JSON.stringify({
        schemaVersion: SESSION_PARSE_CACHE_SCHEMA_VERSION,
        appVersion: 'old',
        entries: [[transcript, legacyRowData]]
      })
    )
    const orphan = join(root, 'session-parse-cache-12345-99.tmp')
    await writeFile(orphan, '{"half":"written')

    simulateRestart(cacheFile)
    // Title synchronization can parse before the first History scan.
    await parse(await writeTranscript(root, 'baaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'))
    await flushSessionParseCachePersist()
    expect(existsSync(cacheFile)).toBe(false)
    expect(existsSync(orphan)).toBe(false)
    await rm(transcript)
    const stats = createSessionParseStats()
    expect(await parseAgentSessionFileCached(candidate, process.platform, stats)).toEqual(session)
    expect(stats).toMatchObject({ reused: 1, fullParses: 0 })
  })

  it('discards an old JSON file from another schema version', async () => {
    const root = await makeTempDir()
    const cacheFile = join(root, 'session-parse-cache.json')
    const transcript = await writeTranscript(root)
    const candidate = await claudeCandidate(transcript)
    await writeFile(
      cacheFile,
      JSON.stringify({
        schemaVersion: SESSION_PARSE_CACHE_SCHEMA_VERSION - 1,
        appVersion: 'old',
        entries: [
          [
            transcript,
            {
              mtimeMs: candidate.file.mtimeMs,
              sizeBytes: candidate.file.sizeBytes,
              platform: process.platform,
              session: null
            }
          ]
        ]
      })
    )
    simulateRestart(cacheFile)
    expect((await parse(transcript)).fullParses).toBe(1)
    expect(existsSync(cacheFile)).toBe(false)
  })

  it('rebuilds a corrupt database instead of failing the scan', async () => {
    const root = await makeTempDir()
    const cacheFile = join(root, 'session-parse-cache.json')
    await writeFile(join(root, 'session-parse-cache.sqlite'), 'not a database at all'.repeat(512))
    vi.spyOn(console, 'debug').mockImplementation(() => {})
    initSessionParseCachePersistence({ filePath: cacheFile, appVersion: APP_VERSION })
    const transcript = await writeTranscript(root)
    expect((await parse(transcript)).fullParses).toBe(1)
    await flushSessionParseCachePersist()

    simulateRestart(cacheFile)
    expect((await parse(transcript)).reused).toBe(1)
  })

  it('drops rows whose transcript is gone and keeps old rows whose transcript is still there', async () => {
    const root = await makeTempDir()
    const cacheFile = join(root, 'session-parse-cache.json')
    initSessionParseCachePersistence({ filePath: cacheFile, appVersion: APP_VERSION })
    const kept = await writeTranscript(root, 'kaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee')
    const deletedOutsideOrca = await writeTranscript(root, 'daaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee')
    await parse(kept)
    await parse(deletedOutsideOrca)
    await flushSessionParseCachePersist()
    resetSessionParseCachePersistenceForTests()
    setSeenAt(cacheFile, kept, Date.now() - 31 * DAY_MS)
    setSeenAt(cacheFile, deletedOutsideOrca, Date.now() - 31 * DAY_MS)
    await rm(deletedOutsideOrca)

    simulateRestart(cacheFile)
    expect((await parse(kept)).reused).toBe(1)
    await vi.waitFor(() => expect(databaseRows(cacheFile).map((row) => row.path)).toEqual([kept]))
    await vi.waitFor(() =>
      expect(databaseRows(cacheFile)[0]!.seen_at).toBeGreaterThan(Date.now() - DAY_MS)
    )
  })

  it('never stats WSL transcripts; their rows age out after half a year unparsed', async () => {
    const root = await makeTempDir()
    const cacheFile = join(root, 'session-parse-cache.json')
    initSessionParseCachePersistence({ filePath: cacheFile, appVersion: APP_VERSION })
    const row = { sizeBytes: 1, platform: 'win32', session: null, resume: null } as const
    const recent = '\\\\wsl.localhost\\Ubuntu\\home\\me\\recent.jsonl'
    const ancient = '\\\\wsl$\\Ubuntu\\home\\me\\ancient.jsonl'
    storeSessionParseCacheEntry(recent, { ...row, mtimeMs: 1 })
    storeSessionParseCacheEntry(ancient, { ...row, mtimeMs: 2 })
    await flushSessionParseCachePersist()
    resetSessionParseCachePersistenceForTests()
    setSeenAt(cacheFile, recent, Date.now() - 31 * DAY_MS)
    setSeenAt(cacheFile, ancient, Date.now() - 181 * DAY_MS)
    const stat = vi.mocked(fsPromises.stat)

    simulateRestart(cacheFile)
    stat.mockClear()
    invalidateSessionParseCacheEntry(join(root, 'opens-the-database.jsonl'))
    await vi.waitFor(() => expect(databaseRows(cacheFile).map((r) => r.path)).toEqual([recent]))
    expect(stat.mock.calls.map(([path]) => String(path))).not.toContain(recent)
  })

  it('invalidating before the first lookup does not bring the row back', async () => {
    const root = await makeTempDir()
    const cacheFile = join(root, 'session-parse-cache.json')
    initSessionParseCachePersistence({ filePath: cacheFile, appVersion: APP_VERSION })
    const transcript = await writeTranscript(root)
    await parse(transcript)
    await flushSessionParseCachePersist()

    simulateRestart(cacheFile)
    invalidateSessionParseCacheEntry(transcript)
    expect((await parse(transcript)).fullParses).toBe(1)
  })

  it('a forced whole read re-reads even when the database delete fails', async () => {
    const root = await makeTempDir()
    const cacheFile = join(root, 'session-parse-cache.json')
    initSessionParseCachePersistence({ filePath: cacheFile, appVersion: APP_VERSION })
    const transcript = await writeTranscript(root)
    await parse(transcript)
    await flushSessionParseCachePersist()

    simulateRestart(cacheFile)
    vi.spyOn(SessionParseCacheDatabase.prototype, 'delete').mockImplementation(() => {})
    const candidate = await claudeCandidate(transcript)
    const stats = createSessionParseStats()
    await parseAgentSessionFileCached(candidate, process.platform, stats, 'whole')
    expect(stats).toMatchObject({ reused: 0, fullParses: 1 })
  })

  it('performs zero disk IO when only configured, as Electron main is', async () => {
    const root = await makeTempDir()
    configureSessionParseCachePersistence({
      filePath: join(root, 'session-parse-cache.json'),
      appVersion: APP_VERSION
    })
    vi.clearAllMocks()
    invalidateSessionParseCacheEntry(join(root, 'deleted.jsonl'))
    await flushSessionParseCachePersist()
    expect(fsPromises.readFile).not.toHaveBeenCalled()
    expect(fsPromises.readdir).not.toHaveBeenCalled()
    expect(await readdir(root)).toEqual([])
  })

  it('swallows database failures and leaves scan results unaffected', async () => {
    const root = await makeTempDir()
    // A file blocking the cache directory fails on Windows and as root, unlike chmod-based fixtures.
    const blocker = join(root, 'blocker')
    await writeFile(blocker, 'a file, not a directory')
    initSessionParseCachePersistence({
      filePath: join(blocker, 'session-parse-cache.json'),
      appVersion: APP_VERSION
    })
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const transcript = await writeTranscript(root)
    expect((await parse(transcript)).fullParses).toBe(1)
    await expect(flushSessionParseCachePersist()).resolves.toBeUndefined()
    expect(debugSpy).toHaveBeenCalled()
    expect((await parse(transcript)).reused).toBe(1)
  })
})

describe('sidecar observations survive the round trip', () => {
  const OBSERVATIONS: [string, SessionSidecarObservation | undefined][] = [
    ['an object', { path: '/chats/a/meta.json', mtimeMs: 42, sizeBytes: 7 }],
    ['none', 'none'],
    ['unknown', 'unknown'],
    ['absent', undefined]
  ]

  it.each(OBSERVATIONS)('restores %s exactly', async (_label, sidecar) => {
    const root = await makeTempDir()
    const cacheFile = join(root, 'session-parse-cache.json')
    const path = await writeTranscript(root)
    initSessionParseCachePersistence({ filePath: cacheFile, appVersion: APP_VERSION })
    await parse(path)
    const entry = getSessionParseCacheEntry(path)
    if (!entry) {
      throw new Error('Expected a completed cached entry')
    }
    storeSessionParseCacheEntry(path, { ...entry, sidecar })
    await flushSessionParseCachePersist()

    simulateRestart(cacheFile)
    expect(getSessionParseCacheEntry(path)?.sidecar).toEqual(sidecar)
  })
})
