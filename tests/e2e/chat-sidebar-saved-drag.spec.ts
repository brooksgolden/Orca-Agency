import { expect, test } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'

test('idle and Done saved chats drag into panes without starting on cancellation', async ({
  orcaPage,
  electronApp
}, testInfo) => {
  test.setTimeout(180_000)
  await electronApp.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.setBackgroundThrottling(false)
    }
  })
  await waitForSessionReady(orcaPage)
  const seed = await orcaPage.evaluate(async () => {
    const s = window.__store!.getState()
    const worktree = Object.values(s.worktreesByRepo).flat()[0]
    const main = s.createTab(worktree.id)
    s.setAiVaultTabTitle(main.id, {
      agent: 'codex',
      sessionId: 'original',
      title: 'Anthony CPA task management'
    })
    // Capture startup without launching a real provider against synthetic history.
    window.__store!.setState({
      queueTabStartupCommand: (_id, command) => {
        document.body.dataset.savedDragCommand = command.command
      }
    })
    const sessions = ['idle-fork', 'done-fork']
    const keys = sessions.map((id) => JSON.stringify(['local', 'codex', id]))
    const now = Date.now() - 3_600_000
    const completed = { [keys[1]]: { at: now + 1000, activityAt: now, done: true } }
    await s.updateSettings({
      theme: 'dark',
      chatSidebar: {
        view: 'chats',
        groupBy: 'status',
        completed,
        sessions: Object.fromEntries(
          sessions.map((sessionId, index) => [
            keys[index],
            {
              worktreeId: worktree.id,
              snapshot: {
                executionHostId: 'local' as const,
                agent: 'codex' as const,
                sessionId,
                title: 'Anthony CPA task management',
                cwd: worktree.path,
                filePath: `/sessions/${sessionId}.jsonl`,
                codexHome: null,
                createdAt: new Date(now).toISOString(),
                updatedAt: new Date(now).toISOString(),
                modifiedAt: new Date(now).toISOString()
              }
            }
          ])
        )
      }
    })
    s.setActiveWorktree(worktree.id)
    s.setActiveView('terminal')
    return {
      worktreeId: worktree.id,
      keys,
      completed,
      initialTabs: window.__store!.getState().tabsByWorktree[worktree.id].length
    }
  })
  const rows = orcaPage.locator('[data-chat-sidebar-id]')
  await expect(rows).toHaveCount(3)
  // Use session identity, not the identical display titles.
  const findRow = (key: string) => rows.locator(`xpath=self::*[@data-chat-sidebar-id='${key}']`)
  const saved = findRow(seed.keys[0])
  await expect(saved).toHaveAttribute('draggable', 'true')
  const cancelled = await orcaPage.evaluateHandle(() => new DataTransfer())
  await saved.dispatchEvent('dragstart', { dataTransfer: cancelled })
  await saved.dispatchEvent('dragend', { dataTransfer: cancelled })
  await expect
    .poll(() =>
      orcaPage.evaluate(
        (id) => window.__store!.getState().tabsByWorktree[id].length,
        seed.worktreeId
      )
    )
    .toBe(seed.initialTabs)
  expect(await orcaPage.evaluate(() => document.body.dataset.savedDragCommand)).toBeUndefined()
  await cancelled.dispose()

  for (const [index, key] of seed.keys.entries()) {
    const row = findRow(key)
    await expect(row).toHaveAttribute('draggable', 'true')
    const transfer = await orcaPage.evaluateHandle(() => new DataTransfer())
    await row.dispatchEvent('dragstart', { dataTransfer: transfer })
    if (index === 0) {
      // Background visibility changes must not discard the sidebar's folder-preserving handler.
      await orcaPage.evaluate(async (id) => {
        window.__store!.getState().setActiveWorktree(null)
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        )
        window.__store!.getState().setActiveWorktree(id)
      }, seed.worktreeId)
    }
    const body = orcaPage.locator('[data-tab-group-body-id][data-worktree-id]').first()
    const rect = await body.boundingBox()
    if (!rect) {
      throw new Error('Missing target pane')
    }
    const layer = orcaPage.locator('[data-ai-vault-session-drop-layer="true"]').first()
    const event = {
      dataTransfer: transfer,
      clientX: rect.x + rect.width - 12,
      clientY: rect.y + rect.height / 2
    }
    await layer.dispatchEvent('dragover', event)
    await layer.dispatchEvent('drop', event)
    await expect
      .poll(() =>
        orcaPage.evaluate(
          (id) => window.__store!.getState().tabsByWorktree[id].length,
          seed.worktreeId
        )
      )
      .toBe(seed.initialTabs + index + 1)
    await expect
      .poll(() => orcaPage.evaluate(() => document.body.dataset.savedDragCommand))
      .toContain(index === 0 ? 'idle-fork' : 'done-fork')
    await expect(row).not.toHaveAttribute('data-chat-sub-tab', 'true')
    await transfer.dispose()
  }
  await expect(orcaPage.locator('[data-chat-split-bracket]')).toHaveCount(3)
  await expect(orcaPage.locator('[data-chat-folder]')).toHaveCount(3)
  await expect
    .poll(() =>
      orcaPage.evaluate(() => window.__store!.getState().settings?.chatSidebar?.completed)
    )
    .toEqual(seed.completed)
  await orcaPage.screenshot({ path: testInfo.outputPath('saved-chat-dropped-panes.png') })
})
