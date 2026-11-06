import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  planAgentSpawnBacklog,
  runAgentSpawnBacklogMigration,
  transcriptEvidenceFromLines,
  type TranscriptEvidence
} from './agent-spawn-backlog-migration'

const claudeUser = (text: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ type: 'user', message: { content: text }, ...extra })
const claudeToolResult = JSON.stringify({
  type: 'user',
  message: { content: [{ type: 'tool_result', content: 'ok' }] }
})
const DISPATCH =
  'You are working inside Orca, a multi-agent IDE.\n...\n=== TASK ===\nYour task ID is: task_1'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('transcriptEvidenceFromLines', () => {
  it('finds the dispatch preamble as the first Claude user turn and ignores tool results', () => {
    const evidence = transcriptEvidenceFromLines(
      [claudeUser(DISPATCH), claudeToolResult, claudeUser('ignored meta', { isMeta: true })],
      'claude'
    )
    expect(evidence).toEqual({ dispatchPrompt: true, laterUserTurns: 0 })
  })

  it('counts a later typed Claude turn as human activity', () => {
    const evidence = transcriptEvidenceFromLines([claudeUser(DISPATCH), claudeUser('hi')], 'claude')
    expect(evidence.laterUserTurns).toBe(1)
  })

  it('recognises the typed dispatch lead line as a dispatch prompt', () => {
    const evidence = transcriptEvidenceFromLines(
      [
        claudeUser(
          'Please carry out this task from my Orca coordinator by following the brief I pasted below.'
        )
      ],
      'claude'
    )
    expect(evidence.dispatchPrompt).toBe(true)
  })

  it('reads Codex user messages and skips injected context blocks', () => {
    const codexLine = (text: string) =>
      JSON.stringify({
        type: 'response_item',
        payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] }
      })
    const evidence = transcriptEvidenceFromLines(
      [codexLine('<environment_context>x</environment_context>'), codexLine(DISPATCH)],
      'codex'
    )
    expect(evidence).toEqual({ dispatchPrompt: true, laterUserTurns: 0 })
  })

  it('reports no dispatch marker for an ordinary typed first message', () => {
    const evidence = transcriptEvidenceFromLines([claudeUser('fix the login bug')], 'claude')
    expect(evidence.dispatchPrompt).toBe(false)
  })
})

describe('planAgentSpawnBacklog', () => {
  const dispatchOnly: TranscriptEvidence = { dispatchPrompt: true, laterUserTurns: 0 }
  const session = (key: string, transcriptPath: string | null = `${key}.jsonl`) => ({
    key,
    agent: 'claude',
    transcriptPath
  })

  it('hides only dispatch-marked chats with no later user turn', () => {
    const plan = planAgentSpawnBacklog({
      sessions: [session('a'), session('b')],
      automationChats: [],
      humanChats: [],
      readEvidence: (path) =>
        path === 'a.jsonl' ? dispatchOnly : { dispatchPrompt: true, laterUserTurns: 2 }
    })
    expect(plan.hide).toEqual(['a'])
    expect(plan.keepReasons).toEqual({ 'later user turns exist (possibly human)': 1 })
  })

  it('keeps human-touched chats even with a dispatch marker', () => {
    const plan = planAgentSpawnBacklog({
      sessions: [session('a')],
      automationChats: [],
      humanChats: ['a'],
      readEvidence: () => dispatchOnly
    })
    expect(plan.hide).toEqual([])
    expect(plan.keepReasons).toEqual({ 'human-touched': 1 })
  })

  it('keeps chats whose transcript is missing or unreadable', () => {
    const plan = planAgentSpawnBacklog({
      sessions: [session('a', null), session('b')],
      automationChats: [],
      humanChats: [],
      readEvidence: () => null
    })
    expect(plan.hide).toEqual([])
    expect(plan.keepReasons).toEqual({
      'no transcript recorded': 1,
      'transcript unreadable or missing': 1
    })
  })

  it('leaves chats without a dispatch marker visible', () => {
    const plan = planAgentSpawnBacklog({
      sessions: [session('a')],
      automationChats: [],
      humanChats: [],
      readEvidence: () => ({ dispatchPrompt: false, laterUserTurns: 0 })
    })
    expect(plan.hide).toEqual([])
    expect(plan.keepReasons).toEqual({ 'no agent-spawn evidence': 1 })
  })

  it('hides a manifest category only when no later user turn exists', () => {
    const manifest = {
      categories: {
        'handle-in-transcript': { confidence: 'high' as const, keys: ['a', 'b'] }
      },
      applyCategories: ['handle-in-transcript']
    }
    const plan = planAgentSpawnBacklog({
      sessions: [session('a'), session('b')],
      automationChats: [],
      humanChats: [],
      manifest,
      readEvidence: (path) =>
        path === 'a.jsonl'
          ? { dispatchPrompt: false, laterUserTurns: 0 }
          : { dispatchPrompt: false, laterUserTurns: 3 }
    })
    expect(plan.hide).toEqual(['a'])
    expect(plan.hideByCategory).toEqual({ 'handle-in-transcript': 1 })
    expect(plan.keepReasons).toEqual({ 'later user turns exist (possibly human)': 1 })
  })

  it('ignores manifest categories that are not listed for application', () => {
    const plan = planAgentSpawnBacklog({
      sessions: [session('a')],
      automationChats: [],
      humanChats: [],
      manifest: {
        categories: { 'medium-only': { confidence: 'medium', keys: ['a'] } },
        applyCategories: []
      },
      readEvidence: () => ({ dispatchPrompt: false, laterUserTurns: 0 })
    })
    expect(plan.hide).toEqual([])
  })

  it('does not re-count chats that are already automated', () => {
    const plan = planAgentSpawnBacklog({
      sessions: [session('a')],
      automationChats: ['a'],
      humanChats: [],
      readEvidence: () => dispatchOnly
    })
    expect(plan.hide).toEqual([])
    expect(plan.keepReasons).toEqual({})
  })
})

describe('runAgentSpawnBacklogMigration', () => {
  it('streams transcript evidence and records the one-time settings marker', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'orca-agent-spawn-backlog-'))
    temporaryDirectories.push(directory)
    const transcriptPath = join(directory, 'worker.jsonl')
    writeFileSync(transcriptPath, `${claudeUser(DISPATCH)}\n${claudeToolResult}\n`, 'utf8')
    const key = JSON.stringify(['local', 'claude', 'worker-session'])
    let settings = {
      chatSidebar: {
        sessions: { [key]: { snapshot: { filePath: transcriptPath } } },
        automationChats: [] as string[],
        humanChats: [] as string[]
      }
    }
    const store = {
      getSettings: () => settings,
      updateSettings: (updates: typeof settings) => {
        settings = updates
      }
    } as unknown as Parameters<typeof runAgentSpawnBacklogMigration>[0]

    const result = await runAgentSpawnBacklogMigration(store, directory)

    expect(result?.addedKeys).toEqual([key])
    expect(settings.chatSidebar.automationChats).toEqual([key])
    expect(store.getSettings().chatSidebar?.agentSpawnBacklogMigration?.id).toBe(
      'agent-spawn-backlog-v1'
    )
  })
})
