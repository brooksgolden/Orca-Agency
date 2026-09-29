import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'

test('new chats choose real folders, default consistently, and retain their configured default', async ({
  orcaPage,
  electronApp
}, testInfo) => {
  test.setTimeout(180_000)
  await electronApp.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.setBackgroundThrottling(false)
    }
  })
  await orcaPage.addStyleTag({
    content: '*, *::before, *::after { animation: none !important; transition: none !important; }'
  })
  const root = testInfo.outputPath('chat-creation')
  const inbox = path.join(root, 'Uncategorized')
  const client = path.join(root, 'Client Work')
  mkdirSync(inbox, { recursive: true })
  mkdirSync(client, { recursive: true })
  await waitForSessionReady(orcaPage)
  await orcaPage.evaluate(
    async ({ inbox, client }) => {
      const s = window.__store!.getState()
      await window.api.projectGroups.create({
        name: 'Uncategorized',
        parentPath: inbox,
        createdFrom: 'manual'
      })
      await window.api.projectGroups.create({
        name: 'Wrong old display label',
        parentPath: client,
        createdFrom: 'manual'
      })
      await s.fetchProjectGroups()
      await s.updateSettings({
        defaultTuiAgent: 'blank',
        chatSidebar: { ...s.settings?.chatSidebar, view: 'chats', defaultFolder: undefined }
      })
    },
    { inbox, client }
  )
  const newChatButton = orcaPage.getByRole('button', { name: 'New chat', exact: true })
  await expect(newChatButton).toBeVisible()
  await expect(newChatButton).toBeEnabled()
  // Hidden Windows renderers do not reliably produce pointer-stability animation frames.
  await newChatButton.click({ force: true })
  const dialog = orcaPage.getByRole('dialog', { name: 'New chat', exact: true })
  const picker = dialog.getByRole('combobox', { name: 'Folder', exact: true })
  await expect(picker).toContainText('Uncategorized (default)')
  await picker.click({ force: true })
  await expect(orcaPage.getByRole('option', { name: 'Client Work', exact: true })).toBeVisible()
  await expect(
    orcaPage.getByRole('option', { name: 'Wrong old display label', exact: true })
  ).toHaveCount(0)
  await orcaPage.getByRole('option', { name: 'Client Work', exact: true }).click({ force: true })
  const start = dialog.getByRole('button', { name: /^Start chat/ })
  await expect(start).toBeEnabled()
  await start.click({ force: true })
  await expect(dialog).toHaveCount(0)
  const created = await orcaPage.evaluate(() => {
    const s = window.__store!.getState()
    return s.folderWorkspaces.find((f) => `folder:${f.id}` === s.activeWorktreeId)
  })
  expect(created?.folderPath.replaceAll('\\', '/')).toBe(client.replaceAll('\\', '/'))
  expect(created?.name).toBe('Client Work')
  await orcaPage.evaluate(() => {
    const s = window.__store!.getState()
    const tab = s.tabsByWorktree[s.activeWorktreeId!]?.[0]
    if (!tab) {
      throw new Error('New chat terminal was not created')
    }
    s.setAiVaultTabTitle(tab.id, {
      agent: 'codex',
      sessionId: 'new-folder-chat',
      title: 'Plan client campaign'
    })
  })
  await expect(
    orcaPage.locator('[data-chat-sidebar-id]').filter({ hasText: 'Plan client campaign' })
  ).toContainText('Client Work')
  await newChatButton.click({ force: true })
  await expect(picker).toContainText('Uncategorized (default)')
  await dialog.getByRole('button', { name: 'Close', exact: true }).click({ force: true })
  await expect(dialog).toHaveCount(0)
  const chat = orcaPage
    .locator('[data-chat-sidebar-id]')
    .filter({ hasText: 'Plan client campaign' })
  await chat.click({ button: 'right', force: true })
  await orcaPage
    .getByRole('menuitem', { name: 'Change folder', exact: true })
    .hover({ force: true })
  await orcaPage
    .getByRole('menuitem', { name: 'New folder...', exact: true })
    .click({ force: true })
  const folderDialog = orcaPage.getByRole('dialog', { name: 'New folder', exact: true })
  await folderDialog.getByLabel('Folder name', { exact: true }).fill('New Client')
  await folderDialog.getByLabel('Create inside', { exact: true }).fill(root)
  await folderDialog
    .getByRole('button', { name: 'Create folder', exact: true })
    .click({ force: true })
  await expect(folderDialog).toHaveCount(0)
  await expect(chat).toContainText('New Client')
  await newChatButton.click({ force: true })
  await picker.click({ force: true })
  await expect(orcaPage.getByRole('option', { name: 'New Client', exact: true })).toBeVisible()
  await orcaPage.keyboard.press('Escape')
  await expect(picker).toHaveAttribute('aria-expanded', 'false')
  await dialog.getByRole('button', { name: 'Close', exact: true }).click({ force: true })
  await expect(dialog).toHaveCount(0)
  await orcaPage.evaluate(() => {
    const s = window.__store!.getState()
    s.openSettingsTarget({ pane: 'general', sectionId: 'general-default-chat-folder' })
    s.openSettingsPage()
  })
  const setting = orcaPage.getByRole('combobox', { name: 'Default chat folder', exact: true })
  await setting.click({ force: true })
  await orcaPage.getByRole('option', { name: 'Client Work', exact: true }).click({ force: true })
  await expect(setting).toContainText('Client Work (default)')
  await orcaPage.getByRole('button', { name: 'Back to app', exact: true }).click({ force: true })
  await orcaPage.reload()
  await waitForSessionReady(orcaPage)
  await expect(newChatButton).toBeEnabled()
  await newChatButton.click({ force: true })
  await expect(picker).toContainText('Client Work (default)')
  await orcaPage.screenshot({ path: testInfo.outputPath('new-chat-folder-default.png') })
})
