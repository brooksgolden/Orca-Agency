import { beforeEach, expect, it, vi } from 'vitest'
import { createGlobalSettingsFixture } from '../../../../shared/global-settings-test-fixture'
import { chatRow, chatWorktree } from './chat-sidebar-test-fixtures'
import { setChatFolder, updateChatSidebar } from './chat-sidebar-preferences'

const mocks = vi.hoisted(() => ({ getState: vi.fn() }))
vi.mock('@/store', () => ({ useAppStore: { getState: mocks.getState } }))
beforeEach(() => vi.clearAllMocks())

it('rebinds saved launcher ownership after an earlier settings response overwrites memory', async () => {
  const settings = createGlobalSettingsFixture()
  settings.chatSidebar = {
    sessions: {
      saved: {
        worktreeId: chatWorktree.id,
        resumeLauncher: {
          agent: 'claude',
          sessionId: 'conversation',
          transcriptPath: '/saved/chat.jsonl',
          tabId: 'live',
          paneKey: 'live:pane',
          targetSessionIdPrefix: 'conversation'
        }
      }
    }
  }
  let release = () => {}
  const wait = new Promise<void>((resolve) => {
    release = resolve
  })
  const state = {
    settings,
    updateSettings: vi.fn(async (update) => {
      await wait
      state.settings = { ...state.settings, ...update }
    })
  }
  mocks.getState.mockReturnValue(state)
  const olderSave = updateChatSidebar({ groupBy: 'recent' })
  await Promise.resolve()
  const moved = setChatFolder(
    chatRow({ tabId: 'live', worktree: { ...chatWorktree, id: 'separate' } }),
    chatWorktree,
    chatWorktree.id
  )
  release()
  await Promise.all([olderSave, moved])
  expect(state.settings.chatSidebar?.sessions?.saved.worktreeId).toBe('separate')
})
