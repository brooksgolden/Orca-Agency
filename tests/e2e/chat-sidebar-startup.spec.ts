import { expect, test } from './helpers/orca-app'

test('startup preserves saved statuses before terminal tabs and live activity reconnect', async ({
  orcaPage,
  electronApp
}, testInfo) => {
  test.setTimeout(180_000)
  await electronApp.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.setBackgroundThrottling(false)
    }
  })
  const seed = await orcaPage.evaluate(async () => {
    const state = window.__store!.getState()
    const worktree = Object.values(state.worktreesByRepo).flat()[0]
    const now = Date.now()
    const sessionIds = ['startup-working', 'startup-idle', 'startup-closed']
    const keys = sessionIds.map((id) => JSON.stringify(['local', 'codex', id]))
    const completed = { [keys[2]]: { at: now - 60_000, activityAt: now - 120_000, done: true } }
    await state.updateSettings({
      chatSidebar: {
        view: 'chats',
        groupBy: 'status',
        completed,
        sessions: Object.fromEntries(
          sessionIds.map((sessionId, index) => [
            keys[index],
            {
              worktreeId: worktree.id,
              snapshot: {
                executionHostId: 'local' as const,
                agent: 'codex' as const,
                sessionId,
                title: ['Existing active chat', 'Existing older chat', 'Previously closed chat'][
                  index
                ],
                cwd: worktree.path,
                filePath: `/sessions/${sessionId}.jsonl`,
                codexHome: null,
                createdAt: new Date(now - 3600_000).toISOString(),
                // Transcript metadata may advance after Done without a submitted prompt.
                updatedAt: new Date(
                  now - (index === 2 ? 5_000 : (index + 1) * 30_000)
                ).toISOString(),
                modifiedAt: new Date(now - (index + 1) * 30_000).toISOString()
              }
            }
          ])
        )
      }
    })
    return { worktreeId: worktree.id, keys, completed, now }
  })
  await orcaPage.reload()
  const rows = orcaPage.locator('[data-chat-sidebar-id]')
  const working = rows.filter({ hasText: 'Existing active chat' })
  const idle = rows.filter({ hasText: 'Existing older chat' })
  const closed = rows.filter({ hasText: 'Previously closed chat' })
  await expect(working).toBeVisible()
  await expect(working).toHaveAttribute('data-chat-completed', 'false')
  await expect(idle).toHaveAttribute('data-chat-completed', 'false')
  await expect(closed).toHaveAttribute('data-chat-completed', 'true')
  await expect
    .poll(() =>
      orcaPage.evaluate(() => window.__store!.getState().settings?.chatSidebar?.completed)
    )
    .toEqual(seed.completed)
  await orcaPage.evaluate(({ worktreeId, now }) => {
    const state = window.__store!.getState()
    const tab = state.createTab(worktreeId)
    const paneKey = `${tab.id}:77777777-7777-4777-8777-777777777777`
    window.__store!.setState((current) => ({
      tabsByWorktree: {
        ...current.tabsByWorktree,
        [worktreeId]: current.tabsByWorktree[worktreeId].map((item) =>
          item.id === tab.id
            ? {
                ...item,
                launchAgent: 'codex',
                aiVaultTitle: {
                  agent: 'codex',
                  sessionId: 'startup-working',
                  title: 'Existing active chat'
                }
              }
            : item
        )
      },
      agentStatusByPaneKey: {
        ...current.agentStatusByPaneKey,
        [paneKey]: {
          paneKey,
          tabId: tab.id,
          worktreeId,
          state: 'working',
          agentType: 'codex',
          prompt: 'The original turn is still running',
          stateStartedAt: now - 90_000,
          updatedAt: now,
          stateHistory: [],
          providerSession: { key: 'session_id', id: 'startup-working' }
        }
      }
    }))
  }, seed)
  await expect(working).toHaveAttribute('data-chat-state', 'working')
  await expect(working).toHaveAttribute('data-chat-completed', 'false')
  await expect(rows.first()).toHaveAttribute('data-chat-sidebar-id', seed.keys[0])
  await expect(idle).toBeVisible()
  await expect(closed).toBeVisible()
  await expect
    .poll(() =>
      orcaPage.evaluate(() => window.__store!.getState().settings?.chatSidebar?.completed)
    )
    .toEqual(seed.completed)
  await orcaPage.screenshot({ path: testInfo.outputPath('chat-sidebar-restored-statuses.png') })
  await expect
    .poll(() =>
      orcaPage.evaluate(async () => (await window.api.settings.get()).chatSidebar?.completed)
    )
    .toEqual(seed.completed)
  await orcaPage.reload()
  await expect(working).toBeVisible()
  await expect(working).toHaveAttribute('data-chat-completed', 'false')
  await expect(idle).toHaveAttribute('data-chat-completed', 'false')
  await expect(closed).toHaveAttribute('data-chat-completed', 'true')
  await expect
    .poll(() =>
      orcaPage.evaluate(async () => (await window.api.settings.get()).chatSidebar?.completed)
    )
    .toEqual(seed.completed)
})
