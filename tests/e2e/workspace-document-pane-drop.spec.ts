import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'
import { retryTransientMainEvaluate } from './helpers/electron-main-evaluate-retry'

async function dragTo(
  page: Parameters<typeof waitForSessionReady>[0],
  start: { x: number; y: number },
  end: { x: number; y: number }
): Promise<void> {
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x + 20, start.y + 20, { steps: 3 })
  await page.mouse.move(end.x, end.y, { steps: 8 })
}

test('external workspace drop stacks chats while preserving a full-height Markdown pane', async ({
  orcaPage,
  electronApp
}, testInfo) => {
  // Why: the rendered split drag needs app startup, terminal readiness, and layout settling.
  test.setTimeout(120_000)
  await retryTransientMainEvaluate(() =>
    electronApp.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.setBackgroundThrottling(false)
        window.setContentSize(1200, 900)
      }
    })
  )
  await waitForSessionReady(orcaPage)

  const folders = [testInfo.outputPath('document-owner'), testInfo.outputPath('incoming-chat')]
  folders.forEach((folder) => mkdirSync(folder, { recursive: true }))
  const markdownPath = path.join(folders[0], 'plan.md')
  writeFileSync(markdownPath, '# Retained document pane\n')

  const ids = await orcaPage.evaluate(async (paths) => {
    const group = await window.api.projectGroups.create({
      name: 'Document pane placement',
      parentPath: paths[0]
    })
    const workspaces: string[] = []
    for (const [index, folderPath] of paths.entries()) {
      const workspace = await window.api.folderWorkspaces.create({
        projectGroupId: group.id,
        folderPath,
        name: index === 0 ? 'Document owner' : 'Incoming chat'
      })
      workspaces.push(`folder:${workspace.id}`)
    }
    return workspaces
  }, folders)
  await orcaPage.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 })
  for (const id of ids) {
    await orcaPage
      .locator(`[role="option"][data-worktree-id="${id}"]`)
      .first()
      .locator('[data-worktree-card-surface]')
      .click()
    await expect(
      orcaPage.locator(`[data-workspace-surface-id="${id}"] .xterm:visible`)
    ).toHaveCount(1, { timeout: 30_000 })
  }

  const groups = await orcaPage.evaluate(
    ({ owner, filePath }) => {
      const store = window.__store!
      const state = store.getState()
      const terminal = state.unifiedTabsByWorktree[owner]?.find(
        (tab) => tab.contentType === 'terminal'
      )
      if (!terminal) {
        throw new Error('Document owner workspace has no chat/terminal tab')
      }
      const markdownId = state.openFile(
        {
          filePath,
          relativePath: 'plan.md',
          worktreeId: owner,
          language: 'markdown',
          mode: 'edit'
        },
        { preview: false, targetGroupId: terminal.groupId }
      )
      const markdownGroupId = store
        .getState()
        .createEmptySplitGroup(owner, terminal.groupId, 'right')
      if (!markdownGroupId) {
        throw new Error('Could not create Markdown split group')
      }
      store.getState().moveUnifiedTabToGroup(markdownId, markdownGroupId)
      store.getState().setActiveWorktree(owner)
      store.getState().setActiveTabType('terminal', owner)
      return { chatGroupId: terminal.groupId, markdownGroupId }
    },
    { owner: ids[0], filePath: markdownPath }
  )

  const pane = (workspaceId: string, groupId: string) =>
    orcaPage.locator(
      `[data-workspace-surface-id="${workspaceId}"][aria-hidden="false"] [data-workspace-pane-group-id="${groupId}"]:visible`
    )
  const chatPane = pane(ids[0], groups.chatGroupId)
  const markdownPane = pane(ids[0], groups.markdownGroupId)
  await expect(chatPane).toBeVisible()
  await expect(markdownPane).toBeVisible()
  const chatBefore = (await chatPane.boundingBox())!
  const markdownBefore = (await markdownPane.boundingBox())!

  const incomingCard = orcaPage
    .locator(`[role="option"][data-worktree-id="${ids[1]}"]`)
    .first()
    .locator('[data-worktree-card-surface]')
  const incomingBounds = (await incomingCard.boundingBox())!
  await dragTo(
    orcaPage,
    {
      x: incomingBounds.x + incomingBounds.width / 2,
      y: incomingBounds.y + incomingBounds.height / 2
    },
    { x: chatBefore.x + chatBefore.width / 2, y: chatBefore.y + chatBefore.height * 0.12 }
  )
  const preview = orcaPage.locator('[data-workspace-drop-edge="top"]:visible')
  await expect(preview).toHaveCount(1)
  const previewBounds = (await preview.boundingBox())!
  expect(Math.abs(previewBounds.x - chatBefore.x)).toBeLessThan(4)
  expect(Math.abs(previewBounds.width - chatBefore.width)).toBeLessThan(4)
  expect(previewBounds.height).toBeLessThan(chatBefore.height * 0.65)
  await orcaPage.screenshot({ path: testInfo.outputPath('document-pane-drop-preview.png') })
  await orcaPage.mouse.up()

  const incomingPane = orcaPage.locator(
    `[data-workspace-surface-id="${ids[1]}"][aria-hidden="false"] [data-workspace-tab-group-id]:visible`
  )
  await expect(incomingPane).toBeVisible()
  await expect
    .poll(async () => {
      const [chat, markdown, incoming] = await Promise.all([
        chatPane.boundingBox(),
        markdownPane.boundingBox(),
        incomingPane.boundingBox()
      ])
      if (!chat || !markdown || !incoming) {
        return false
      }
      const close = (left: number, right: number) => Math.abs(left - right) < 12
      return (
        close(markdown.x, markdownBefore.x) &&
        close(markdown.y, markdownBefore.y) &&
        close(markdown.width, markdownBefore.width) &&
        close(markdown.height, markdownBefore.height) &&
        close(incoming.x, chat.x) &&
        incoming.y < chat.y &&
        close(incoming.width, chat.width) &&
        close(incoming.y + incoming.height, chat.y) &&
        close(chat.y + chat.height, markdown.y + markdown.height)
      )
    })
    .toBe(true)
  await orcaPage.screenshot({ path: testInfo.outputPath('document-pane-drop-result.png') })
})
