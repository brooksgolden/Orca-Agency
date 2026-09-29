import { expect, test } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'

test('split windows stay bracketed and adjacent until unsplit', async ({
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
    const original = Object.values(s.worktreesByRepo).flat()[0]
    const group = await window.api.projectGroups.create({
      name: 'Bracket test',
      parentPath: original.path
    })
    await s.fetchProjectGroups()
    const ids: string[] = []
    const names = ['Working split chat', 'Old split partner', 'Recent independent chat']
    for (let index = 0; index < names.length; index++) {
      const folder = await s.createFolderWorkspace({
        projectGroupId: group.id,
        folderPath: original.path,
        name: original.path.split(/[\\/]/).at(-1)
      })
      if (!folder) {
        throw new Error('Could not create bracket test workspace')
      }
      const id = `folder:${folder.id}`
      ids.push(id)
      const tab = s.createTab(id)
      s.setAiVaultTabTitle(tab.id, { agent: 'codex', sessionId: tab.id, title: names[index] })
      window.__store!.setState((current) => ({
        agentStatusByPaneKey: {
          ...current.agentStatusByPaneKey,
          [`${tab.id}:77777777-7777-4777-8777-777777777777`]: {
            paneKey: `${tab.id}:77777777-7777-4777-8777-777777777777`,
            state: index === 0 ? 'working' : 'done',
            agentType: 'codex',
            prompt: names[index],
            stateStartedAt: Date.now() - (index === 1 ? 18_000_000 : 60_000),
            updatedAt: Date.now() - (index === 1 ? 18_000_000 : 60_000),
            stateHistory: [],
            providerSession: { key: 'session_id', id: tab.id }
          }
        }
      }))
    }
    await s.updateSettings({ chatSidebar: { view: 'chats', groupBy: 'recent' } })
    return ids
  })
  const rows = orcaPage.locator('[data-chat-sidebar-id]')
  await expect(rows).toHaveCount(3)
  await expect(rows.nth(0)).toContainText('Working split chat')
  await expect(rows.nth(1)).toContainText('Recent independent chat')
  await orcaPage.evaluate(
    ([first, second]) => window.__store!.getState().placeWorkspaceAtEdge(second, first, 'right'),
    ids
  )
  await expect(rows.nth(1)).toContainText('Old split partner')
  await expect(orcaPage.locator('[data-chat-split-bracket]')).toHaveCount(2)
  expect(await rows.nth(0).getAttribute('data-chat-split-group')).toBe(
    await rows.nth(1).getAttribute('data-chat-split-group')
  )
  const first = await rows.nth(0).boundingBox()
  const second = await rows.nth(1).boundingBox()
  expect(Math.abs(second!.y - first!.y - first!.height)).toBeLessThan(1)
  await orcaPage.screenshot({ path: testInfo.outputPath('split-chat-bracket.png') })
  await orcaPage.evaluate((id) => window.__store!.getState().unsplitWorkspace(id), ids[1])
  await expect(orcaPage.locator('[data-chat-split-bracket]')).toHaveCount(0)
  await expect(rows.nth(1)).toContainText('Recent independent chat')
  await expect(rows.nth(2)).toContainText('Old split partner')
})
