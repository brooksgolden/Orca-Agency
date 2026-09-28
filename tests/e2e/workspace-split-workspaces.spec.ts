import { expect, test } from './helpers/orca-app'

test('sidebar pairing, member navigation, unsplit, and workspace drag keep full panes', async ({
  orcaPage
}, testInfo) => {
  test.setTimeout(180_000)
  const [firstId, secondId] = await orcaPage.evaluate(() => {
    const state = window.__store!.getState()
    const worktrees = Object.values(state.worktreesByRepo).find((items) => items.length >= 2)
    if (!worktrees) {
      throw new Error('Expected the seeded primary and secondary workspaces')
    }
    return worktrees.slice(0, 2).map((worktree) => worktree.id)
  })
  const row = (id: string) => orcaPage.locator(`[role="option"][data-worktree-id="${id}"]`)
  const surface = (id: string) => orcaPage.locator(`[data-workspace-surface-id="${id}"]`)

  await orcaPage.evaluate((id) => {
    const state = window.__store!.getState()
    const activeTab = state.getActiveTab(id)
    if (!activeTab) {
      throw new Error('Expected a terminal tab in the primary workspace')
    }
    const splitGroupId = state.createEmptySplitGroup(id, activeTab.groupId, 'down', {
      activate: false
    })
    if (!splitGroupId) {
      throw new Error('Could not create a split tab group')
    }
    state.createTab(id, splitGroupId, undefined, { activate: false })
  }, firstId)
  await expect(surface(firstId).locator('[data-tab-group-body-id]')).toHaveCount(2)
  await row(firstId).locator('[data-worktree-card-surface]').click({ button: 'right' })
  await orcaPage.getByRole('menuitem', { name: 'Split with workspace' }).hover()
  const secondLabel = await orcaPage.evaluate((id) => {
    const worktree = Object.values(window.__store!.getState().worktreesByRepo)
      .flat()
      .find((item) => item.id === id)
    return worktree?.displayName || worktree?.path.split(/[\\/]/).findLast(Boolean) || ''
  }, secondId)
  await orcaPage.getByRole('menuitem', { name: secondLabel, exact: true }).click()
  await expect(orcaPage.locator('[data-workspace-split="true"]')).toBeVisible()
  await expect(surface(firstId)).toBeVisible()
  await expect(surface(secondId)).toBeVisible()
  await expect(surface(firstId).locator('[data-tab-group-body-id]')).toHaveCount(2)
  if (await surface(secondId).locator('[data-workspace-empty-pane]').isVisible()) {
    await surface(secondId).getByRole('button', { name: 'New terminal' }).click()
  }
  await expect(surface(secondId).locator('[data-tab-group-body-id]')).toBeVisible()

  await row(secondId).locator('[data-worktree-card-surface]').click()
  await expect(orcaPage.locator('[data-workspace-split="true"]')).toBeVisible()
  await expect(surface(firstId)).toBeVisible()
  await expect(surface(secondId)).toBeVisible()
  await expect(surface(firstId).locator('[data-tab-group-body-id]')).toHaveCount(2)

  await row(secondId).locator('[data-worktree-card-surface]').click({ button: 'right' })
  await orcaPage.getByRole('menuitem', { name: 'Unsplit workspace' }).click()
  await expect(orcaPage.locator('[data-workspace-split="true"]')).toHaveCount(0)
  await expect(row(firstId)).toHaveAttribute('aria-current', 'page')
  await expect(surface(firstId)).toBeVisible()
  await expect(surface(secondId)).not.toBeVisible()

  const bounds = await surface(firstId).boundingBox()
  expect(bounds).not.toBeNull()
  await row(secondId)
    .locator('[data-worktree-card-surface]')
    .dragTo(surface(firstId), {
      sourcePosition: { x: 80, y: 16 },
      targetPosition: { x: 8, y: Math.floor(bounds!.height / 2) }
    })
  await expect(orcaPage.locator('[data-workspace-board-sheet]')).toHaveCount(0)
  await expect(orcaPage.locator('[data-workspace-split="true"]')).toBeVisible()
  await expect(surface(firstId)).toBeVisible()
  await expect(surface(secondId)).toBeVisible()
  await expect(row(secondId)).toHaveAttribute('aria-current', 'page')

  // A card released over the workspace area where no pane takes it is a cancel: no
  // sidebar reorder, and the sort mode stays as the user chose it.
  await orcaPage.evaluate(() => window.__store!.getState().setSortBy('recent'))
  const rowOrder = () =>
    orcaPage.evaluate(() =>
      Array.from(document.querySelectorAll('[role="option"][data-worktree-id]')).map((element) =>
        element.getAttribute('data-worktree-id')
      )
    )
  const orderBefore = await rowOrder()
  const firstRowBox = await row(firstId).boundingBox()
  const ownPaneBox = await surface(secondId).boundingBox()
  expect(firstRowBox).not.toBeNull()
  expect(ownPaneBox).not.toBeNull()
  await row(secondId)
    .locator('[data-worktree-card-surface]')
    .dragTo(surface(secondId), {
      sourcePosition: { x: 80, y: 16 },
      targetPosition: {
        x: Math.floor(ownPaneBox!.width / 2),
        y: Math.max(1, Math.floor(firstRowBox!.y + firstRowBox!.height / 2 - ownPaneBox!.y))
      }
    })
  await expect(orcaPage.locator('[data-workspace-split="true"]')).toBeVisible()
  expect(await orcaPage.evaluate(() => window.__store!.getState().sortBy)).toBe('recent')
  expect(await rowOrder()).toEqual(orderBefore)

  await orcaPage.reload()
  await row(firstId).locator('[data-worktree-card-surface]').click()
  await expect(orcaPage.locator('[data-workspace-split="true"]')).toBeVisible()
  await expect(surface(firstId)).toBeVisible()
  await expect(surface(secondId)).toBeVisible()
  await orcaPage.screenshot({ path: testInfo.outputPath('workspace-split.png') })
})
