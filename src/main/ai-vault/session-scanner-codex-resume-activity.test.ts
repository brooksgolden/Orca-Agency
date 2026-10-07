import { describe, expect, it } from 'vitest'
import {
  createCodexSessionResumeState,
  parseCodexSessionContent
} from './session-scanner-codex-parser'

const before = '2026-09-20T05:47:31.884Z'
const reopened = '2026-10-01T07:26:12.417Z'
const file = {
  path: '/sessions/rollout-test.jsonl',
  mtimeMs: Date.parse(reopened),
  modifiedAt: reopened
}
type CodexTestPayload = {
  id?: string
  cwd?: string
  type?: string
  role?: string
  content?: { type: string; text: string }[]
  pad?: string
}

const record = (type: string, payload: CodexTestPayload, timestamp: string) =>
  JSON.stringify({ timestamp, type, payload })
const history = [
  record('session_meta', { id: 'session', cwd: '/workspace' }, '2026-09-20T05:40:00.000Z'),
  record(
    'response_item',
    {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: 'Check daily status' }]
    },
    '2026-09-20T05:40:01.000Z'
  ),
  record('event_msg', { type: 'task_complete' }, before)
]

describe('Codex resume activity', () => {
  it.each([false, true])(
    'ignores resume settings without losing the next turn (large=%s)',
    async (large) => {
      // Captured from a resumed idle chat: this append updates settings, not the conversation.
      const resume = record(
        'event_msg',
        { type: 'thread_settings_applied', ...(large ? { pad: 'x'.repeat(2048) } : {}) },
        reopened
      )
      const lines = [...history, resume]
      const parsed = await parseCodexSessionContent({ file, content: lines.join('\n') })
      expect(parsed?.updatedAt).toBe(before)
      const incremental = createCodexSessionResumeState(file, null)
      for (const line of history) {
        incremental.consumeLineBytes!(Buffer.from(line))
      }
      incremental.consumeLineBytes!(Buffer.from(resume))
      expect((await incremental.finalize('win32'))?.updatedAt).toBe(before)
      const next = record('event_msg', { type: 'task_started' }, '2026-10-01T08:00:00.000Z')
      incremental.consumeLineBytes!(Buffer.from(next))
      expect((await incremental.finalize('win32'))?.updatedAt).toBe('2026-10-01T08:00:00.000Z')
    }
  )
})
