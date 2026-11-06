import type { RuntimeTerminalRead } from '../../shared/runtime-terminal-read'
import {
  AGENT_PROMPT_POST_PASTE_SUBMIT_DELAY_MS,
  AGENT_PROMPT_SUBMIT
} from '../../shared/agent-prompt-injection'
import type { AgentPromptActivity } from './agent-prompt-submission-verification'
import {
  hasCodexBusyQueueHint,
  matchesCodexBusyQueueComposer,
  matchesCodexComposerDraft
} from './codex-busy-queue-prompt'
import { TUI_AGENT_CONFIG } from '../../shared/tui-agent-config'

type CodexBusyQueueSubmissionOptions = {
  expectedDraft: string
  pasteIngestMs: number
  signal?: AbortSignal
  readScreen: () => Promise<RuntimeTerminalRead>
  assertFence: (allowIdle: boolean) => AgentPromptActivity
  beforeWrite?: () => Promise<void> | void
  getActivity: () => AgentPromptActivity
  assertPermissionSafe: (activity: AgentPromptActivity) => void
  reserveWrite: () => void
  write: (key: string) => boolean
  wait: (ms: number, signal?: AbortSignal) => Promise<void>
}

export async function submitCodexBusyPrompt({
  expectedDraft,
  pasteIngestMs,
  signal,
  readScreen,
  assertFence,
  beforeWrite,
  getActivity,
  assertPermissionSafe,
  reserveWrite,
  write,
  wait
}: CodexBusyQueueSubmissionOptions): Promise<AgentPromptActivity> {
  await wait(pasteIngestMs + AGENT_PROMPT_POST_PASTE_SUBMIT_DELAY_MS, signal)
  const deadline = Date.now() + TUI_AGENT_CONFIG.codex.draftPasteReadyTimeoutMs!
  let screen = await readScreen()
  let activity = assertFence(true)
  while (
    !matchesCodexComposerDraft(screen, expectedDraft) ||
    (activity.status === 'working' && !hasCodexBusyQueueHint(screen))
  ) {
    if (Date.now() >= deadline) {
      throw new Error('agent_prompt_stalled')
    }
    await wait(50, signal)
    screen = await readScreen()
    activity = assertFence(true)
  }

  await beforeWrite?.()
  activity = assertFence(true)
  screen = await readScreen()
  if (!matchesCodexComposerDraft(screen, expectedDraft)) {
    throw new Error('agent_prompt_stalled')
  }
  activity = assertFence(true)
  if (activity.status === 'working' && !matchesCodexBusyQueueComposer(screen, expectedDraft)) {
    throw new Error('agent_prompt_stalled')
  }
  const baseline = getActivity()
  assertPermissionSafe(baseline)
  const submitKey = activity.status === 'idle' ? AGENT_PROMPT_SUBMIT : '\t'
  reserveWrite()
  if (!write(submitKey)) {
    throw new Error('terminal_not_writable')
  }
  return baseline
}
