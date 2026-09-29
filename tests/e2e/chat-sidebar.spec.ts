import { expect, test } from './helpers/orca-app'

test('workspace groups retain chat names, status, ordering and exact tab navigation', async ({
  orcaPage,
  electronApp
}, testInfo) => {
  test.setTimeout(180_000)
  // Why: hidden Windows renderers must keep frames ticking for pointer stability checks.
  await electronApp.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.setBackgroundThrottling(false)
    }
  })
  const ids = await orcaPage.evaluate(async () => {
    const state = window.__store!.getState()
    const worktree = Object.values(state.worktreesByRepo).flat()[0]
    const first = state.createTab(worktree.id)
    const second = state.createTab(worktree.id)
    const now = Date.now()
    window.__store!.setState((current) => ({
      tabsByWorktree: {
        ...current.tabsByWorktree,
        [worktree.id]: current.tabsByWorktree[worktree.id].map((tab) =>
          tab.id === first.id || tab.id === second.id
            ? {
                ...tab,
                launchAgent: 'codex',
                aiVaultTitle: {
                  agent: 'codex',
                  sessionId: tab.id,
                  title: tab.id === first.id ? 'Older running task' : 'Recently finished task'
                }
              }
            : tab
        )
      },
      agentStatusByPaneKey: {
        ...current.agentStatusByPaneKey,
        [`${first.id}:77777777-7777-4777-8777-777777777777`]: {
          paneKey: `${first.id}:77777777-7777-4777-8777-777777777777`,
          state: 'working',
          prompt: 'Work',
          agentType: 'codex',
          stateStartedAt: now - 60_000,
          updatedAt: now - 60_000,
          stateHistory: [],
          providerSession: { key: 'session_id', id: first.id }
        }
      }
    }))
    await state.updateSettings({ chatSidebar: { view: 'chats', groupBy: 'status' } })
    return {
      first: JSON.stringify(['local', 'codex', first.id]),
      second: JSON.stringify(['local', 'codex', second.id]),
      firstTab: first.id,
      secondTab: second.id,
      worktreeId: worktree.id
    }
  })
  const rows = orcaPage.locator('[data-chat-sidebar-id]')
  const first = rows.filter({ hasText: 'Older running task' })
  const second = rows.filter({ hasText: 'Recently finished task' })
  await expect(first).toBeVisible()
  await expect(second).toBeVisible()
  await expect(first).toHaveAttribute('data-chat-state', 'working')
  await expect(rows.first()).toHaveAttribute('data-chat-sidebar-id', ids.first)
  const firstBounds = await first.boundingBox()
  expect(firstBounds!.height).toBe(28)
  await expect(second).toHaveAttribute('data-chat-sub-tab', 'true')
  expect(await second.getAttribute('data-chat-workspace-group')).toBe(
    await first.getAttribute('data-chat-workspace-group')
  )
  await second.click()
  await expect
    .poll(() => orcaPage.evaluate(() => window.__store!.getState().activeTabId))
    .toBe(ids.secondTab)
  await second.click({ button: 'right' })
  await orcaPage.getByRole('menuitem', { name: 'Rename chat', exact: true }).click()
  await orcaPage
    .getByRole('textbox', { name: 'Chat name', exact: true })
    .fill('Aside profile extensions')
  await orcaPage.getByRole('button', { name: 'Save', exact: true }).click()
  const renamed = rows.filter({ hasText: 'Aside profile extensions' })
  await expect(renamed).toBeVisible()
  await expect(first).toBeVisible()
  await renamed.getByRole('button', { name: 'Mark Aside profile extensions done' }).click()
  await expect(renamed).toHaveAttribute('data-chat-completed', 'true')
  await expect(rows.first()).toHaveAttribute('data-chat-sidebar-id', ids.first)
  await renamed.getByRole('button', { name: 'Reopen Aside profile extensions' }).click()
  await expect(renamed).toHaveAttribute('data-chat-completed', 'false')
  await orcaPage.getByRole('textbox', { name: 'Find chat' }).fill('Aside')
  // A matching sub-tab retains the main chat above it for context.
  await expect(rows).toHaveCount(2)
  await orcaPage.getByRole('textbox', { name: 'Find chat' }).fill('')
  await expect(rows).toHaveCount(2)
  // One tab stop for the list; arrows move between chats and Enter opens the focused one.
  await expect(rows.and(orcaPage.locator('[tabindex="0"]'))).toHaveCount(1)
  await first.focus()
  await orcaPage.keyboard.press('ArrowDown')
  await expect(renamed).toBeFocused()
  await orcaPage.keyboard.press('ArrowUp')
  await expect(first).toBeFocused()
  await orcaPage.keyboard.press('Enter')
  await expect
    .poll(() => orcaPage.evaluate(() => window.__store!.getState().activeTabId))
    .toBe(ids.firstTab)
  await expect(first).toHaveAttribute('aria-selected', 'true')
  await expect(renamed).toHaveAttribute('aria-selected', 'false')
  // A registered closed chat stays listed from its snapshot even when no history scan returns it.
  // The renamed chat also gets the snapshot a history scan would record, so reload can prove its
  // name survives even though this hidden profile restores no terminal tabs.
  await orcaPage.evaluate(
    async ({ worktreeId, renamedSessionId }) => {
      const state = window.__store!.getState()
      const snapshot = (sessionId: string, title: string) => ({
        executionHostId: 'local' as const,
        agent: 'codex' as const,
        sessionId,
        title,
        cwd: null,
        filePath: `/sessions/${sessionId}.jsonl`,
        codexHome: null,
        createdAt: null,
        updatedAt: new Date(Date.now() - 3_600_000).toISOString(),
        modifiedAt: new Date(Date.now() - 3_600_000).toISOString()
      })
      const chatSidebar = state.settings!.chatSidebar!
      await state.updateSettings({
        chatSidebar: {
          ...chatSidebar,
          sessions: {
            ...chatSidebar.sessions,
            [JSON.stringify(['local', 'codex', 'closed-e2e'])]: {
              worktreeId,
              snapshot: snapshot('closed-e2e', 'Closed snapshot chat')
            },
            [JSON.stringify(['local', 'codex', renamedSessionId])]: {
              worktreeId,
              snapshot: snapshot(renamedSessionId, 'Recently finished task')
            }
          }
        }
      })
    },
    { worktreeId: ids.worktreeId, renamedSessionId: ids.secondTab }
  )
  const closed = rows.filter({ hasText: 'Closed snapshot chat' })
  await expect(closed).toBeVisible()
  await expect(closed).toHaveAttribute('aria-selected', 'false')
  await expect(rows).toHaveCount(3)
  await orcaPage.screenshot({ path: testInfo.outputPath('chat-sidebar.png') })
  await orcaPage.reload()
  await expect(orcaPage.locator('[data-chat-sidebar]')).toBeVisible()
  await expect(
    orcaPage.locator('[data-chat-sidebar-id]').filter({ hasText: 'Aside profile extensions' })
  ).toBeVisible()
  await expect(
    orcaPage.locator('[data-chat-sidebar-id]').filter({ hasText: 'Closed snapshot chat' })
  ).toBeVisible()
})
