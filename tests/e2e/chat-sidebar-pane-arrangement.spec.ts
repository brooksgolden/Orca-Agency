import { expect, test } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'

test('prompted and resumed chats follow tab and pane arrangement', async ({
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
  const ids = await orcaPage.evaluate(async () => {
    const s = window.__store!.getState()
    const worktree = Object.values(s.worktreesByRepo).flat()[0]
    const main = s.createTab(worktree.id)
    const child = s.createTab(worktree.id)
    s.setAiVaultTabTitle(main.id, {
      agent: 'codex',
      sessionId: main.id,
      title: 'Main conversation'
    })
    await s.updateSettings({ theme: 'dark', chatSidebar: { view: 'chats', groupBy: 'status' } })
    s.setActiveWorktree(worktree.id)
    s.setActiveView('terminal')
    return { worktreeId: worktree.id, worktreePath: worktree.path, main: main.id, child: child.id }
  })
  const rows = orcaPage.locator('[data-chat-sidebar-id]')
  const main = rows.filter({ hasText: 'Main conversation' })
  await expect(rows).toHaveCount(1)
  await orcaPage.evaluate(({ child, worktreeId, worktreePath }) => {
    const key = `${child}:77777777-7777-4777-8777-777777777777`
    window.__store!.setState((s) => ({
      agentStatusByPaneKey: {
        ...s.agentStatusByPaneKey,
        [key]: {
          paneKey: key,
          worktreeId,
          tabId: child,
          agentType: 'claude',
          state: 'done',
          prompt: 'Short prompt',
          stateStartedAt: Date.now() - 1_000,
          updatedAt: Date.now(),
          stateHistory: [],
          providerSession: {
            key: 'session_id',
            id: child,
            transcriptPath: `/home/.claude/projects/${worktreePath.replace(/[^a-zA-Z0-9]/g, '-')}/${child}.jsonl`
          }
        }
      }
    }))
  }, ids)
  const child = rows.filter({ hasText: 'Short prompt' })
  await expect(child).toHaveAttribute('data-chat-sub-tab', 'true')
  for (const agent of ['claude', 'codex'] as const) {
    await orcaPage.evaluate(
      async ({ agent, worktreeId }) => {
        const s = window.__store!.getState(),
          sessionId = `restored-${agent}`,
          key = JSON.stringify(['local', agent, sessionId])
        await s.updateSettings({
          chatSidebar: {
            ...s.settings!.chatSidebar,
            hidden: [...(s.settings!.chatSidebar?.hidden ?? []), key]
          }
        })
        const tab = s.createTab(worktreeId)
        s.setAiVaultTabTitle(tab.id, { agent, sessionId, title: `Resumed ${agent} conversation` })
      },
      { agent, worktreeId: ids.worktreeId }
    )
    await expect(rows.filter({ hasText: `Resumed ${agent} conversation` })).toHaveAttribute(
      'data-chat-sub-tab',
      'true'
    )
  }
  await expect(rows).toHaveCount(4)
  await expect(orcaPage.locator('[data-chat-sub-tab-elbow]')).toHaveCount(3)
  const splitGroup = await orcaPage.evaluate(({ child, worktreeId }) => {
    const s = window.__store!.getState()
    const tab = s.unifiedTabsByWorktree[worktreeId].find((t) => t.entityId === child)!
    if (!s.dropUnifiedTab(tab.id, { groupId: tab.groupId, splitDirection: 'right' })) {
      throw new Error('Split drop failed')
    }
    return window
      .__store!.getState()
      .unifiedTabsByWorktree[worktreeId].find((t) => t.id === tab.id)!.groupId
  }, ids)
  await expect(child).not.toHaveAttribute('data-chat-sub-tab', 'true')
  await expect(orcaPage.locator('[data-chat-split-bracket]')).toHaveCount(4)
  await expect(orcaPage.locator('[data-chat-sub-tab-elbow]')).toHaveCount(2)
  await expect(orcaPage.locator('[data-chat-folder]')).toHaveCount(1)
  await expect(rows.last()).toContainText('Short prompt')
  await orcaPage.screenshot({ path: testInfo.outputPath('separate-panes-bracket.png') })
  await orcaPage.evaluate(
    ({ worktreeId, splitGroup }) =>
      window.__store!.getState().mergeGroupIntoSibling(worktreeId, splitGroup),
    { worktreeId: ids.worktreeId, splitGroup }
  )
  await expect(child).toHaveAttribute('data-chat-sub-tab', 'true')
  await expect(orcaPage.locator('[data-chat-split-bracket]')).toHaveCount(0)
  await expect(orcaPage.locator('[data-chat-sub-tab-elbow]')).toHaveCount(3)
  await expect(main).toBeVisible()
  await orcaPage.screenshot({ path: testInfo.outputPath('shared-pane-elbows.png') })
  await orcaPage.evaluate((tabId) => window.__store!.getState().closeTab(tabId), ids.child)
  await expect(child).not.toHaveAttribute('data-chat-sub-tab', 'true')
  await expect(child).toHaveAttribute('data-chat-completed', 'true')
  await expect(orcaPage.locator('[data-chat-sub-tab-elbow]')).toHaveCount(2)
})
