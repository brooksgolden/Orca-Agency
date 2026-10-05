import { expect, test } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'
import { retryTransientMainEvaluate } from './helpers/electron-main-evaluate-retry'

test('blue tab-group preview creates a bottom-right quadrant without moving the workspace', async ({
  orcaPage,
  electronApp
}, info) => {
  test.setTimeout(120_000)
  await retryTransientMainEvaluate(() =>
    electronApp.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.setBackgroundThrottling(false)
        window.setContentSize(1100, 1200)
      }
    })
  )
  await waitForSessionReady(orcaPage)
  const ids = await orcaPage.evaluate(() => {
    const s = window.__store!.getState()
    const workspace = Object.values(s.worktreesByRepo).flat()[0].id
    const first = s.tabsByWorktree[workspace]?.[0] ?? s.createTab(workspace)
    const main = s.createTab(workspace)
    const root = window
      .__store!.getState()
      .unifiedTabsByWorktree[workspace].find((tab) => tab.id === main.id)!.groupId
    const right = s.createEmptySplitGroup(workspace, root, 'right')!
    const destination = s.createTab(workspace, right)
    const bottom = s.createEmptySplitGroup(workspace, root, 'down')!
    const retained = s.createTab(workspace, bottom)
    for (const [index, tab] of [main, destination, retained].entries()) {
      s.setAiVaultTabTitle(tab.id, {
        agent: 'codex',
        sessionId: tab.id,
        title: `Native chat ${index}`
      })
    }
    s.setActiveWorktree(workspace)
    s.setActiveView('terminal')
    return {
      workspace,
      source: main.id,
      first: first.id,
      root,
      destination: destination.id,
      right,
      retained: retained.id
    }
  })
  expect(ids.first).not.toBe(ids.source)
  const sourceTab = orcaPage.locator(`[data-tab-id="${ids.source}"]:visible`)
  const first = await orcaPage.locator(`[data-tab-id="${ids.first}"]:visible`).boundingBox()
  const original = await sourceTab.boundingBox()
  await orcaPage.mouse.move(original!.x + 40, original!.y + 16)
  await orcaPage.mouse.down()
  await orcaPage.mouse.move(first!.x + 8, first!.y + 16, { steps: 16 })
  await expect(orcaPage.locator('[data-workspace-window-drop]:visible')).toHaveCount(0)
  await orcaPage.mouse.up()
  expect(await orcaPage.evaluate(() => window.__store!.getState().workspaceSplitGroups)).toEqual([])
  const order = await orcaPage.evaluate(
    ({ workspace, root }) =>
      window.__store!.getState().groupsByWorktree[workspace].find((group) => group.id === root)!
        .tabOrder,
    ids
  )
  expect(order.indexOf(ids.source)).toBeLessThan(order.indexOf(ids.first))
  const body = orcaPage.locator(`[data-tab-group-body-id="${ids.right}"]`)
  await expect(body).toBeVisible()
  const destination = await body.boundingBox()
  const source = await orcaPage.locator(`[data-tab-id="${ids.source}"]:visible`).boundingBox()
  await orcaPage.mouse.move(source!.x + 40, source!.y + 16)
  await orcaPage.mouse.down()
  await orcaPage.mouse.move(
    destination!.x + destination!.width / 2,
    destination!.y + destination!.height * 0.85,
    { steps: 16 }
  )
  const preview = orcaPage.locator('.tab-drop-overlay:visible')
  await expect(preview).toHaveCount(1)
  await expect(preview).toContainText('New split')
  await expect(orcaPage.locator('[data-workspace-window-drop]:visible')).toHaveCount(0)
  const overlay = await preview.boundingBox()
  expect(Math.abs(overlay!.width - destination!.width)).toBeLessThan(3)
  expect(overlay!.y).toBeGreaterThan(destination!.y + destination!.height * 0.4)
  await orcaPage.screenshot({ path: info.outputPath('blue-bottom-right-preview.png') })
  await orcaPage.mouse.up()
  await expect
    .poll(() =>
      orcaPage.evaluate(({ source, destination, workspace, root }) => {
        const s = window.__store!.getState()
        const a = s.unifiedTabsByWorktree[workspace].find((tab) => tab.id === source)
        const b = s.unifiedTabsByWorktree[workspace].find((tab) => tab.id === destination)
        return Boolean(a && b && a.groupId !== root && a.groupId !== b.groupId)
      }, ids)
    )
    .toBe(true)
  const sourceAfter = await orcaPage.locator(`[data-tab-id="${ids.source}"]:visible`).boundingBox()
  const destinationAfter = await orcaPage
    .locator(`[data-tab-id="${ids.destination}"]:visible`)
    .boundingBox()
  expect(Math.abs(sourceAfter!.x - destinationAfter!.x)).toBeLessThan(3)
  expect(sourceAfter!.y).toBeGreaterThan(destinationAfter!.y)
  await expect(orcaPage.locator(`[data-tab-id="${ids.retained}"]:visible`)).toBeVisible()
  expect(await orcaPage.evaluate(() => window.__store!.getState().workspaceSplitGroups)).toEqual([])
  await orcaPage.screenshot({ path: info.outputPath('blue-bottom-right-result.png') })
})
