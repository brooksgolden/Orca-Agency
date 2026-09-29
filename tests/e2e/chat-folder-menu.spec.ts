import { mkdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from './helpers/orca-app'

test('chat folders change independently, create real directories, and filter persistently', async ({
  orcaPage
}, testInfo) => {
  test.setTimeout(180_000)
  const parent = testInfo.outputPath('chat-folders')
  mkdirSync(parent, { recursive: true })
  const ids = await orcaPage.evaluate(async () => {
    const state = window.__store!.getState()
    const worktree = Object.values(state.worktreesByRepo).flat()[0]
    const first = state.createTab(worktree.id)
    const second = state.createTab(worktree.id)
    state.setAiVaultTabTitle(first.id, {
      agent: 'codex',
      sessionId: 'folder-chat-a',
      title: 'Folder move chat'
    })
    state.setAiVaultTabTitle(second.id, {
      agent: 'codex',
      sessionId: 'folder-chat-b',
      title: 'Sibling stays here'
    })
    await state.updateSettings({ chatSidebar: { view: 'chats', groupBy: 'recent' } })
    return { first: first.id, worktree: worktree.id }
  })
  const rows = orcaPage.locator('[data-chat-sidebar-id]')
  const moving = rows.filter({ hasText: 'Folder move chat' })
  const sibling = rows.filter({ hasText: 'Sibling stays here' })
  await expect(moving).toBeVisible()
  const originalSibling = await sibling.textContent()
  await moving.click({ button: 'right' })
  await orcaPage.getByRole('menuitem', { name: 'Change folder', exact: true }).hover()
  await orcaPage.getByRole('menuitem', { name: 'New folder...', exact: true }).click()
  await orcaPage.getByLabel('Folder name', { exact: true }).fill('Alpha folder')
  await orcaPage.getByLabel('Create inside', { exact: true }).fill(parent)
  await orcaPage.getByRole('button', { name: 'Create folder', exact: true }).click()
  await expect(moving).toContainText('Alpha folder')
  expect(existsSync(path.join(parent, 'Alpha folder'))).toBe(true)
  expect(existsSync(path.join(parent, 'Alpha folder', '.git'))).toBe(false)
  await expect(sibling).toHaveText(originalSibling!)
  await expect(moving).toHaveAttribute('data-worktree-id', ids.worktree)
  await moving.click()
  await expect
    .poll(() => orcaPage.evaluate(() => window.__store!.getState().activeTabId))
    .toBe(ids.first)
  await expect(orcaPage.getByRole('combobox', { name: 'Filter chats by folder' })).toHaveCount(0)
  const options = orcaPage.getByRole('button', { name: /Chat grouping and folder filters/ })
  await options.click()
  await orcaPage.getByRole('menuitem', { name: 'Folders', exact: true }).hover()
  await orcaPage.getByRole('menuitemcheckbox', { name: 'Alpha folder', exact: true }).click()
  await orcaPage.keyboard.press('Escape')
  await orcaPage.keyboard.press('Escape')
  await expect(moving).toHaveCount(0)
  await expect(sibling).toBeVisible()
  await orcaPage.reload()
  await expect(sibling).toBeVisible()
  await expect(moving).toHaveCount(0)
  await options.click()
  await orcaPage.getByRole('menuitemradio', { name: 'Status', exact: true }).click()
  await expect(moving).toHaveCount(0)
  await options.click()
  await orcaPage.getByRole('menuitem', { name: 'Folders', exact: true }).hover()
  await orcaPage.getByRole('menuitem', { name: 'Show all folders', exact: true }).click()
  await expect(moving).toBeVisible()
  await expect(moving).toContainText('Alpha folder')
  await moving.click({ button: 'right' })
  await orcaPage.getByRole('menuitem', { name: 'Change folder', exact: true }).hover()
  const newFolder = orcaPage.getByRole('menuitem', { name: 'New folder...', exact: true })
  await expect(newFolder).toBeVisible()
  const submenu = orcaPage.getByRole('menu').filter({ has: newFolder })
  const labels = await submenu.getByRole('menuitem').allTextContents()
  expect(labels[0]).toBe('New folder...')
  expect(labels.slice(1)).toEqual(labels.slice(1).sort((a, b) => a.localeCompare(b)))
  await orcaPage.screenshot({ path: testInfo.outputPath('change-folder-menu.png') })
})
