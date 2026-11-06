import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  _electron as electron,
  test,
  expect,
  type Page,
  type ElectronApplication
} from '@stablyai/playwright-test'
import { getE2ECompletedOnboardingProfile } from './helpers/e2e-completed-onboarding-profile'
import { createElectronHomeIsolation } from './helpers/electron-home-isolation'
import { cleanupE2EDaemons, closeElectronAppForE2E } from './helpers/electron-process-shutdown'
import { assertPackagedExecutableIdentity } from './helpers/packaged-executable-identity'
import { retryTransientMainEvaluate } from './helpers/electron-main-evaluate-retry'
import { captureHiddenRendererScreenshot } from './helpers/hidden-renderer-screenshot'

async function dragTo(page: Page, start: { x: number; y: number }, end: { x: number; y: number }) {
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x + 20, start.y + 20, { steps: 3 })
  await page.mouse.move(end.x, end.y, { steps: 8 })
}

async function captureDragLayout(app: ElectronApplication, page: Page, outputPath: string) {
  await app.evaluate(async ({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find((item) =>
      item.webContents.getURL().includes('index.html')
    )!
    await window.capturePage(undefined, { stayHidden: true, stayAwake: true })
  })
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  )
  const data = await app.evaluate(async ({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find((item) =>
      item.webContents.getURL().includes('index.html')
    )!
    const capture = await window.capturePage(undefined, { stayHidden: true, stayAwake: true })
    if (capture.isEmpty()) {
      throw new Error('Hidden drag layout capture is empty')
    }
    return capture.toPNG().toString('base64')
  })
  writeFileSync(outputPath, Buffer.from(data, 'base64'))
}

test('packaged external fourth corner survives a desktop restart', async (// oxlint-disable-next-line no-empty-pattern -- Playwright requires a destructured fixture argument.
{}, testInfo) => {
  const executablePath = process.env.ORCA_SMOKE_EXECUTABLE
  test.skip(!executablePath, 'Set ORCA_SMOKE_EXECUTABLE to the reviewed package')
  test.setTimeout(480_000)
  const profilePath = testInfo.outputPath('profile')
  mkdirSync(profilePath, { recursive: true })
  const profile = getE2ECompletedOnboardingProfile()
  writeFileSync(
    path.join(profilePath, 'orca-data.json'),
    JSON.stringify({
      ...profile,
      settings: { ...profile.settings, chatSidebar: { view: 'workspaces' } }
    })
  )
  const { ELECTRON_RUN_AS_NODE: _unused, ...inheritedEnv } = process.env
  void _unused
  const isolation = createElectronHomeIsolation({
    inheritedEnv,
    launchEnv: {},
    extraEnv: {},
    userDataDir: profilePath
  })
  let app = await electron.launch({
    executablePath,
    args: [],
    env: {
      ...isolation.env,
      ORCA_BACKGROUND_LAUNCH: '1',
      ORCA_E2E_HEADLESS: '1',
      PLAYWRIGHT_LEGACY_SCREENSHOT: '1'
    }
  })
  try {
    await assertPackagedExecutableIdentity(app, executablePath)
    const page = await app.firstWindow({ timeout: 60_000 })
    await retryTransientMainEvaluate(() =>
      app.evaluate(({ BrowserWindow }) => {
        for (const window of BrowserWindow.getAllWindows()) {
          window.webContents.setBackgroundThrottling(false)
        }
      })
    )
    await page.waitForFunction(() => Boolean(window.api))
    const folders = ['shared', 'second', 'third', 'shared'].map((name) =>
      path.join(profilePath, name)
    )
    folders.forEach((folder) => mkdirSync(folder, { recursive: true }))
    const ids = await page.evaluate(async (paths) => {
      const group = await window.api.projectGroups.create({
        name: 'Drag projects',
        parentPath: paths[0]
      })
      const ids: string[] = []
      for (const [index, folderPath] of paths.entries()) {
        const workspace = await window.api.folderWorkspaces.create({
          projectGroupId: group.id,
          folderPath,
          name: `Drag ${index}`
        })
        ids.push(`folder:${workspace.id}`)
      }
      return ids
    }, folders)
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 })
    for (const id of ids) {
      await page
        .locator(`[role="option"][data-worktree-id="${id}"]`)
        .first()
        .locator('[data-worktree-card-surface]')
        .click()
      await expect(page.locator(`[data-workspace-surface-id="${id}"] .xterm:visible`)).toHaveCount(
        1,
        { timeout: 30_000 }
      )
    }
    await page
      .locator(`[role="option"][data-worktree-id="${ids[2]}"]`)
      .first()
      .locator('[data-worktree-card-surface]')
      .click()
    const rejectedPane = page.locator(`[data-workspace-surface-id="${ids[2]}"]:visible`)
    await rejectedPane.getByRole('button', { name: 'New tab', exact: true }).click()
    await page.getByRole('menuitem', { name: /New Terminal: PowerShell/ }).dispatchEvent('click')
    await expect(rejectedPane.locator('[data-tab-id]')).toHaveCount(2)
    await rejectedPane.getByRole('button', { name: 'New tab', exact: true }).click()
    await page.getByRole('menuitem', { name: /New Terminal: PowerShell/ }).dispatchEvent('click')
    await expect(rejectedPane.locator('[data-tab-id]')).toHaveCount(3)
    await expect
      .poll(async () => (await page.evaluate(() => window.api.pty.listSessions())).length, {
        timeout: 30_000
      })
      .toBe(6)
    const initial = await page.evaluate(async () => {
      await window.api.session.flush()
      return window.api.session.get()
    })
    const terminalIds = ids.map((id) => initial.tabsByWorktree[id][0].id)
    const initialPtyIds = (await page.evaluate(() => window.api.pty.listSessions()))
      .map((item) => item.id)
      .sort()
    const leaf = (workspaceId: string) => ({ type: 'leaf', workspaceId })
    const pair = (direction: string, first: unknown, second: unknown) => ({
      type: 'split',
      direction,
      first,
      second,
      ratio: 0.5
    })
    const root = page.locator('[data-workspace-split-root]')
    const pane = (id: string) =>
      page
        .locator(
          `[data-workspace-surface-id="${id}"][aria-hidden="false"] [data-workspace-tab-group-id]:has([data-tab-group-strip-id][data-worktree-id="${id}"]):visible`
        )
        .first()
    // An external fourth workspace must stack beneath the two right columns only.
    await page.evaluate(
      (layout) =>
        localStorage.setItem(
          'orca.workspaceSplitGroups.v2',
          JSON.stringify([{ id: 'drag-grid', layout }])
        ),
      pair('horizontal', leaf(ids[0]), pair('horizontal', leaf(ids[1]), leaf(ids[2])))
    )
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 })
    for (const id of ids.slice(0, 3)) {
      await expect(pane(id)).toBeVisible()
    }
    await expect(pane(ids[3])).toHaveCount(0)
    const leftBefore = (await pane(ids[0]).boundingBox())!
    const firstRightBefore = (await pane(ids[1]).boundingBox())!
    const lastRightBefore = (await pane(ids[2]).boundingBox())!
    const incomingCard = page
      .locator(`[role="option"][data-worktree-id="${ids[3]}"]`)
      .first()
      .locator('[data-worktree-card-surface]')
    await expect(incomingCard).toBeVisible()
    const cardBounds = (await incomingCard.boundingBox())!
    const splitBounds = (await root.boundingBox())!
    await dragTo(
      page,
      { x: cardBounds.x + cardBounds.width / 2, y: cardBounds.y + cardBounds.height / 2 },
      { x: splitBounds.x + splitBounds.width * 0.9, y: splitBounds.y + splitBounds.height * 0.9 }
    )
    await expect(page.locator('[data-workspace-quadrant-drop="bottom-right"]')).toBeVisible()
    await captureHiddenRendererScreenshot(page, testInfo.outputPath('external-fourth-preview.png'))
    await page.mouse.up()
    await expect(pane(ids[3])).toBeVisible()
    console.log(
      'external geometry',
      JSON.stringify({
        before: [leftBefore, firstRightBefore, lastRightBefore],
        after: await Promise.all(ids.map((id) => pane(id).boundingBox()))
      })
    )
    await expect
      .poll(async () => {
        const [left, first, last, incoming] = await Promise.all(
          ids.map((id) => pane(id).boundingBox())
        )
        if (!left || !first || !last || !incoming) {
          return false
        }
        const close = (a: number, b: number) => Math.abs(a - b) < 12
        return (
          close(left.x, leftBefore.x) &&
          close(left.y, leftBefore.y) &&
          close(left.width, leftBefore.width) &&
          close(left.height, leftBefore.height) &&
          close(first.x, firstRightBefore.x) &&
          close(last.x, lastRightBefore.x) &&
          close(first.y, last.y) &&
          close(first.height, last.height) &&
          close(incoming.x, first.x) &&
          close(incoming.x + incoming.width, last.x + last.width) &&
          incoming.y > first.y + first.height - 12 &&
          close(incoming.y + incoming.height, left.y + left.height)
        )
      })
      .toBe(true)
    await captureDragLayout(app, page, testInfo.outputPath('external-fourth-result.png'))

    // Confirm the application persisted the dropped layout before closing it.
    await expect
      .poll(async () => page.evaluate(() => localStorage.getItem('orca.workspaceSplitGroups.v2')))
      .toContain(ids[3])
    await closeElectronAppForE2E(app)
    app = await electron.launch({
      executablePath,
      args: [],
      env: {
        ...isolation.env,
        ORCA_BACKGROUND_LAUNCH: '1',
        ORCA_E2E_HEADLESS: '1',
        PLAYWRIGHT_LEGACY_SCREENSHOT: '1'
      }
    })
    await assertPackagedExecutableIdentity(app, executablePath)
    const restored = await app.firstWindow({ timeout: 60_000 })
    await restored.waitForFunction(() => Boolean(window.api))
    await expect
      .poll(
        async () =>
          (await restored.evaluate(() => window.api.pty.listSessions()))
            .map((item) => item.id)
            .sort(),
        { timeout: 60_000 }
      )
      .toEqual(initialPtyIds)
    const restoredSession = await restored.evaluate(() => window.api.session.get())
    expect(ids.map((id) => restoredSession.tabsByWorktree[id][0].id)).toEqual(terminalIds)
    const restoredPane = (id: string) =>
      restored
        .locator(
          `[data-workspace-surface-id="${id}"][aria-hidden="false"] [data-workspace-tab-group-id]:has([data-tab-group-strip-id][data-worktree-id="${id}"]):visible`
        )
        .first()
    for (const id of ids) {
      await expect(restoredPane(id)).toBeVisible({ timeout: 60_000 })
    }
    await expect
      .poll(async () => {
        const [left, first, last, incoming] = await Promise.all(
          ids.map((id) => restoredPane(id).boundingBox())
        )
        if (!left || !first || !last || !incoming) {
          return false
        }
        const close = (a: number, b: number) => Math.abs(a - b) < 12
        return (
          close(left.x, leftBefore.x) &&
          close(left.y, leftBefore.y) &&
          close(left.width, leftBefore.width) &&
          close(left.height, leftBefore.height) &&
          close(first.x, firstRightBefore.x) &&
          close(last.x, lastRightBefore.x) &&
          close(first.y, last.y) &&
          close(first.height, last.height) &&
          close(incoming.x, first.x) &&
          close(incoming.x + incoming.width, last.x + last.width) &&
          incoming.y > first.y + first.height - 12 &&
          close(incoming.y + incoming.height, left.y + left.height)
        )
      })
      .toBe(true)
    await captureDragLayout(app, restored, testInfo.outputPath('external-fourth-after-restart.png'))
  } finally {
    try {
      await closeElectronAppForE2E(app)
    } finally {
      await cleanupE2EDaemons(profilePath)
    }
  }
})
