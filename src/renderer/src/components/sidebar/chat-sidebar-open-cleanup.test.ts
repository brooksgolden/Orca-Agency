import { beforeEach, expect, it, vi } from 'vitest'
import { chatRow, chatSession, chatWorktree } from './chat-sidebar-test-fixtures'
import { openSavedSidebarChat } from './chat-sidebar-open'
import type { AiVaultResumePlacement } from '../right-sidebar/ai-vault-session-launch-actions'

const mocks = vi.hoisted(() => ({ create: vi.fn(), discard: vi.fn() }))
vi.mock('@/store', () => ({ useAppStore: { getState: () => ({}) } }))
vi.mock('./chat-sidebar-rows', () => ({ buildChatSidebarRows: () => [] }))
vi.mock('./chat-sidebar-detach', () => ({
  createSeparateChatWorkspace: mocks.create,
  discardEmptyChatWorkspace: mocks.discard
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))
beforeEach(() => {
  vi.clearAllMocks()
  mocks.discard.mockResolvedValue(undefined)
  mocks.create.mockResolvedValue({
    ...chatWorktree,
    id: 'new-remote-workspace',
    hostId: 'runtime:paired-host'
  })
})

it.each(['created', 'unverifiable', 'not-created'] as const)(
  'does not delete a remote workspace based on delayed local tabs after outcome=%s',
  async (outcome) => {
    const resume = vi.fn()
    await openSavedSidebarChat(
      chatRow({ tabId: null, session: chatSession('remote-saved') }),
      resume
    )
    const placement: AiVaultResumePlacement = resume.mock.calls[0][2]
    placement.onSettled?.(outcome)
    await Promise.resolve()
    expect(mocks.discard).toHaveBeenCalledTimes(outcome === 'not-created' ? 1 : 0)
  }
)
