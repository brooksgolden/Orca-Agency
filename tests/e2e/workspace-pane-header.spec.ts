import { expect, test } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'

test('pane headers close every split, keep chrome at the window edge and drag workspaces', async ({
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
    const worktrees = Object.values(s.worktreesByRepo).find((items) => items.length >= 2)!
    const [left, right] = worktrees.map((w) => w.id)
    await s.createProjectGroup('Pane header folder', {
      parentPath: worktrees[0].path,
      hostId: 'local'
    })
    const a = s.createTab(left),
      b = s.createTab(right)
    s.setAiVaultTabTitle(a.id, { agent: 'codex', sessionId: a.id, title: 'Main conversation' })
    s.setAiVaultTabTitle(b.id, { agent: 'codex', sessionId: b.id, title: 'Other conversation' })
    const root = s.getActiveTab(left)!.groupId
    const bottom = s.createEmptySplitGroup(left, root, 'down')!
    const c = s.createTab(left, bottom)
    s.setAiVaultTabTitle(c.id, { agent: 'claude', sessionId: c.id, title: 'Review conversation' })
    await s.updateSettings({
      theme: 'dark',
      showPaneCommandButton: false,
      chatSidebar: { view: 'chats', groupBy: 'status' }
    })
    s.placeWorkspaceAtEdge(right, left, 'right')
    s.setActiveWorktree(left)
    s.setActiveView('terminal')
    return { left, right, root, bottom, a: a.id, b: b.id, c: c.id }
  })
  const header = (id: string) =>
    orcaPage
      .locator('[data-tab-group-strip-id]')
      .filter({ has: orcaPage.locator(`[data-tab-group-close-button="${id}"]`) })
  const left = orcaPage.locator('[data-workspace-surface-id]').filter({ has: header(ids.root) })
  await expect(orcaPage.locator('[data-tab-group-close-button]:visible')).toHaveCount(2)
  await expect(orcaPage.locator('[data-workspace-unsplit-button]:visible')).toHaveCount(1)
  await expect(
    orcaPage.getByRole('button', { name: 'Add quick command', exact: true })
  ).toHaveCount(0)
  await orcaPage.evaluate(async () => {
    await window.__store!.getState().updateSettings({ showPaneCommandButton: true })
  })
  await expect(
    orcaPage.getByRole('button', { name: 'Add quick command', exact: true })
  ).toBeVisible()
  await orcaPage.evaluate(async () => {
    await window.__store!.getState().updateSettings({ showPaneCommandButton: false })
  })
  for (const groupId of [ids.root, ids.bottom]) {
    const strip = await header(groupId).boundingBox()
    const close = await orcaPage.locator(`[data-tab-group-close-button="${groupId}"]`).boundingBox()
    expect(strip!.x + strip!.width - close!.x - close!.width).toBeLessThan(12)
  }
  const mainStrip = header(ids.root)
  const grab = await mainStrip.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    for (let x = rect.right - 45; x > rect.left; x -= 8) {
      const target = document.elementFromPoint(x, rect.top + 16)
      if (
        target &&
        element.contains(target) &&
        !target.closest('button, [role="tab"], .terminal-tab-strip')
      ) {
        return { x, y: rect.top + 16 }
      }
    }
    throw new Error('No blank header space to drag')
  })
  const bounds = await left.boundingBox()
  await orcaPage.mouse.move(grab.x, grab.y)
  await orcaPage.mouse.down()
  await orcaPage.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height - 8, {
    steps: 8
  })
  await orcaPage.mouse.up()
  await expect
    .poll(() => orcaPage.evaluate(() => window.__store!.getState().workspaceSplitGroups[0].layout))
    .toMatchObject({
      type: 'split',
      direction: 'vertical',
      second: { type: 'leaf', workspaceId: ids.left }
    })
  await expect(orcaPage.locator('[data-tab-group-close-button]:visible')).toHaveCount(2)
  await orcaPage.screenshot({ path: testInfo.outputPath('workspace-header-horizontal.png') })
  await orcaPage.locator(`[data-tab-group-close-button="${ids.bottom}"]`).click()
  await expect(orcaPage.locator(`[data-tab-group-strip-id="${ids.bottom}"]`)).toHaveCount(0)
  await expect
    .poll(() =>
      orcaPage.evaluate((id) => window.__store!.getState().tabsByWorktree[id].length, ids.left)
    )
    .toBeGreaterThan(0)
})
