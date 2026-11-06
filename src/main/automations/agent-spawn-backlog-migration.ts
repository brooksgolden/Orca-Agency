import { createReadStream, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import type { Store } from '../persistence'

/**
 * One-time backlog migration. A saved chat is hidden only with positive evidence that an agent started
 * it and that no person typed in it afterwards. Anything uncertain stays visible. Display only: the
 * transcript, the session and any running process are never touched. Reversible via the receipt.
 */
export const AGENT_SPAWN_BACKLOG_MIGRATION_ID = 'agent-spawn-backlog-v1'
export const AGENT_SPAWN_BACKLOG_RECEIPT_FILE = 'agent-spawn-backlog-migration.json'
export const AGENT_SPAWN_BACKLOG_MANIFEST_FILE = 'agent-spawn-backlog-manifest.json'

const DISPATCH_PREFIX = 'You are working inside Orca, a multi-agent IDE.'
const DISPATCH_LEAD = 'Please carry out this task from my Orca coordinator'

export type TranscriptEvidence = {
  /** The first real user turn is the Orca dispatch preamble or its typed lead line. */
  dispatchPrompt: boolean
  /** Real user turns after the first one; a person's typed message would show here. */
  laterUserTurns: number
}

function userTextFromTranscriptLine(line: string, agent: string): string | null {
  let record: unknown
  try {
    record = JSON.parse(line)
  } catch {
    return null
  }
  const r = record as Record<string, unknown>
  if (agent === 'claude' && r.type === 'user' && !r.isMeta) {
    const content = (r.message as { content?: unknown } | undefined)?.content
    const text =
      typeof content === 'string'
        ? content
        : Array.isArray(content)
          ? content
              .filter((item) => item?.type === 'text' && typeof item.text === 'string')
              .map((item) => item.text as string)
              .join('\n')
          : ''
    return text.trim() ? text : null
  }
  if (agent !== 'codex' || r.type !== 'response_item') {
    return null
  }
  const payload = r.payload as { type?: string; role?: string; content?: unknown } | undefined
  if (payload?.type !== 'message' || payload.role !== 'user' || !Array.isArray(payload.content)) {
    return null
  }
  const text = payload.content
    .filter((item) => typeof item?.text === 'string')
    .map((item) => item.text as string)
    .join('\n')
  const trimmed = text.trimStart()
  // Codex injects context blocks as user-role messages; people do not type those.
  return trimmed && !trimmed.startsWith('<') && !trimmed.startsWith('# AGENTS') ? text : null
}

type SettingsStore = Pick<Store, 'getSettings' | 'updateSettings'>

/** Reads one transcript's user turns, skipping meta records, tool results and injected context. */
export function transcriptEvidenceFromLines(
  lines: Iterable<string>,
  agent: string
): TranscriptEvidence {
  const userTexts: string[] = []
  for (const line of lines) {
    const text = userTextFromTranscriptLine(line, agent)
    if (text !== null) {
      userTexts.push(text)
    }
  }
  if (userTexts.length === 0) {
    return { dispatchPrompt: false, laterUserTurns: 0 }
  }
  const first = userTexts[0]
  return {
    dispatchPrompt: first.includes(DISPATCH_PREFIX) || first.includes(DISPATCH_LEAD),
    laterUserTurns: userTexts.length - 1
  }
}

export type BacklogSession = { key: string; agent: string; transcriptPath: string | null }

export type BacklogPlan = {
  hide: string[]
  keepReasons: Record<string, number>
  hideByCategory: Record<string, number>
}

/**
 * A reviewed evidence manifest from the offline backlog analysis. Only the categories listed in
 * `applyCategories` are used, so a lower-confidence category can be added later without a code change.
 */
export type BacklogManifest = {
  categories: Record<string, { confidence: 'high' | 'medium'; keys: string[] }>
  applyCategories: string[]
}

/**
 * Pure plan. A chat is hidden only when it has positive agent-spawn evidence (the Orca dispatch
 * preamble, or a manifest category) and no later user turn. Anything else stays visible.
 */
export function planAgentSpawnBacklog(input: {
  sessions: readonly BacklogSession[]
  automationChats: readonly string[]
  humanChats: readonly string[]
  readEvidence: (transcriptPath: string, agent: string) => TranscriptEvidence | null
  manifest?: BacklogManifest | null
}): BacklogPlan {
  const automated = new Set(input.automationChats)
  const human = new Set(input.humanChats)
  const hide: string[] = []
  const hideByCategory: Record<string, number> = {}
  const keepReasons: Record<string, number> = {}
  const keep = (reason: string) => {
    keepReasons[reason] = (keepReasons[reason] ?? 0) + 1
  }
  const manifestCategoryOf = new Map<string, string>()
  for (const name of input.manifest?.applyCategories ?? []) {
    for (const key of input.manifest?.categories[name]?.keys ?? []) {
      if (!manifestCategoryOf.has(key)) {
        manifestCategoryOf.set(key, name)
      }
    }
  }
  for (const session of input.sessions) {
    if (automated.has(session.key)) {
      continue
    }
    if (human.has(session.key)) {
      keep('human-touched')
      continue
    }
    if (!session.transcriptPath) {
      keep('no transcript recorded')
      continue
    }
    const evidence = input.readEvidence(session.transcriptPath, session.agent)
    if (!evidence) {
      keep('transcript unreadable or missing')
      continue
    }
    if (evidence.laterUserTurns > 0) {
      // Possibly a person typed here; never hidden by the migration.
      keep('later user turns exist (possibly human)')
      continue
    }
    const category = manifestCategoryOf.get(session.key)
    if (category) {
      hide.push(session.key)
      hideByCategory[category] = (hideByCategory[category] ?? 0) + 1
    } else if (evidence.dispatchPrompt) {
      hide.push(session.key)
      hideByCategory['orca-dispatch-preamble'] = (hideByCategory['orca-dispatch-preamble'] ?? 0) + 1
    } else {
      keep('no agent-spawn evidence')
    }
  }
  return { hide, keepReasons, hideByCategory }
}

function readManifest(path: string): BacklogManifest | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as BacklogManifest
  } catch {
    return null
  }
}

async function readTranscriptEvidence(
  path: string,
  agent: string
): Promise<TranscriptEvidence | null> {
  const input = createReadStream(path, { encoding: 'utf8' })
  const lines = createInterface({ input, crlfDelay: Infinity })
  let firstUserText: string | null = null
  let laterUserTurns = 0
  try {
    for await (const line of lines) {
      const text = userTextFromTranscriptLine(line, agent)
      if (text === null) {
        continue
      }
      if (firstUserText === null) {
        firstUserText = text
        continue
      }
      // One later turn is enough to keep the chat visible. Stop before reading a huge history.
      laterUserTurns = 1
      break
    }
    if (firstUserText === null) {
      return { dispatchPrompt: false, laterUserTurns: 0 }
    }
    return {
      dispatchPrompt:
        firstUserText.includes(DISPATCH_PREFIX) || firstUserText.includes(DISPATCH_LEAD),
      laterUserTurns
    }
  } catch {
    return null
  } finally {
    lines.close()
    input.destroy()
  }
}

function writeReceiptAtomically(path: string, body: unknown): void {
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(body, null, 2), 'utf8')
  renameSync(tmp, path)
}

/** Runs once per install. Returns the receipt, or null when it already ran. */
export async function runAgentSpawnBacklogMigration(
  store: SettingsStore,
  userDataDir: string
): Promise<{
  addedKeys: string[]
  keepReasons: Record<string, number>
  hideByCategory: Record<string, number>
} | null> {
  const sidebar = store.getSettings().chatSidebar ?? {}
  if (sidebar.agentSpawnBacklogMigration?.id === AGENT_SPAWN_BACKLOG_MIGRATION_ID) {
    return null
  }
  const sessions: BacklogSession[] = Object.entries(sidebar.sessions ?? {}).map(([key, entry]) => ({
    key,
    agent: String((JSON.parse(key) as unknown[])[1] ?? ''),
    transcriptPath: entry.snapshot?.filePath ?? null
  }))
  const manifest = readManifest(join(userDataDir, AGENT_SPAWN_BACKLOG_MANIFEST_FILE))
  const evidenceByPath = new Map<string, TranscriptEvidence | null>()
  const automated = new Set(sidebar.automationChats ?? [])
  const human = new Set(sidebar.humanChats ?? [])
  for (const session of sessions) {
    if (
      automated.has(session.key) ||
      human.has(session.key) ||
      !session.transcriptPath ||
      evidenceByPath.has(session.transcriptPath)
    ) {
      continue
    }
    evidenceByPath.set(
      session.transcriptPath,
      await readTranscriptEvidence(session.transcriptPath, session.agent)
    )
  }
  const plan = planAgentSpawnBacklog({
    sessions,
    automationChats: sidebar.automationChats ?? [],
    humanChats: sidebar.humanChats ?? [],
    readEvidence: (transcriptPath) => evidenceByPath.get(transcriptPath) ?? null,
    manifest
  })
  const appliedAt = new Date().toISOString()
  const receiptPath = join(userDataDir, AGENT_SPAWN_BACKLOG_RECEIPT_FILE)
  // Only keys this migration adds are revertible. Chats the owner already hid stay hidden on revert.
  const existing = new Set(sidebar.automationChats ?? [])
  const addedKeys = plan.hide.filter((key) => !existing.has(key))
  // Written before the settings change, so a crash leaves a receipt that explains any hidden chats.
  writeReceiptAtomically(receiptPath, {
    migrationId: AGENT_SPAWN_BACKLOG_MIGRATION_ID,
    appliedAt,
    addedKeys,
    hideByCategory: plan.hideByCategory,
    manifestUsed: manifest !== null,
    keepReasons: plan.keepReasons,
    previousAutomationChatCount: (sidebar.automationChats ?? []).length,
    revert:
      'Remove addedKeys from chatSidebar.automationChats and clear chatSidebar.agentSpawnBacklogMigration.'
  })
  store.updateSettings(
    {
      chatSidebar: {
        ...sidebar,
        automationChats: [...new Set([...existing, ...plan.hide])],
        agentSpawnBacklogMigration: {
          id: AGENT_SPAWN_BACKLOG_MIGRATION_ID,
          appliedAt,
          addedKeys
        }
      }
    },
    { notifyListeners: true }
  )
  return { addedKeys, keepReasons: plan.keepReasons, hideByCategory: plan.hideByCategory }
}

/** Undoes the migration: the hidden keys return to the sidebar. Transcripts were never changed. */
export function revertAgentSpawnBacklogMigration(store: SettingsStore): number {
  const sidebar = store.getSettings().chatSidebar ?? {}
  const marker = sidebar.agentSpawnBacklogMigration
  if (!marker) {
    return 0
  }
  const added = new Set(marker.addedKeys)
  const { agentSpawnBacklogMigration: _removed, ...rest } = sidebar
  store.updateSettings(
    {
      chatSidebar: {
        ...rest,
        automationChats: (sidebar.automationChats ?? []).filter((key) => !added.has(key))
      }
    },
    { notifyListeners: true }
  )
  return added.size
}
