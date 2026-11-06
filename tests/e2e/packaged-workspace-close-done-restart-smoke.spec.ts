import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page
} from '@stablyai/playwright-test'
import { getE2ECompletedOnboardingProfile } from './helpers/e2e-completed-onboarding-profile'
import { createElectronHomeIsolation } from './helpers/electron-home-isolation'
import { cleanupE2EDaemons, closeElectronAppForE2E } from './helpers/electron-process-shutdown'
import { assertPackagedExecutableIdentity } from './helpers/packaged-executable-identity'
import { retryTransientMainEvaluate } from './helpers/electron-main-evaluate-retry'
import { captureHiddenRendererScreenshot } from './helpers/hidden-renderer-screenshot'

async function launchPackaged(
  executablePath: string,
  env: NodeJS.ProcessEnv
): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    executablePath,
    args: [],
    env: {
      ...env,
      ORCA_BACKGROUND_LAUNCH: '1',
      ORCA_E2E_HEADLESS: '1',
      PLAYWRIGHT_LEGACY_SCREENSHOT: '1'
    }
  })
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
  return { app, page }
}

test('packaged workspace close status survives restart', async (// oxlint-disable-next-line no-empty-pattern -- Playwright requires a destructured fixture argument.
{}, testInfo) => {
  const executablePath = process.env.ORCA_SMOKE_EXECUTABLE
  test.skip(!executablePath, 'Set ORCA_SMOKE_EXECUTABLE to the reviewed package')
  // Why: this is exact production-package evidence. Chat completion is covered by the focused
  // component test because production packages intentionally do not expose the renderer store.
  test.setTimeout(360_000)

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

  let app: ElectronApplication | null = null
  try {
    const first = await launchPackaged(executablePath!, isolation.env)
    app = first.app
    const { page } = first
    const folders = ['close-target', 'close-partner'].map((name) => path.join(profilePath, name))
    folders.forEach((folder) => mkdirSync(folder, { recursive: true }))
    const ids = await page.evaluate(async (paths) => {
      const group = await window.api.projectGroups.create({
        name: 'Workspace close projects',
        parentPath: paths[0]
      })
      const ids: string[] = []
      for (const [index, folderPath] of paths.entries()) {
        const workspace = await window.api.folderWorkspaces.create({
          projectGroupId: group.id,
          folderPath,
          name: index === 0 ? 'Close target' : 'Close partner'
        })
        await window.api.folderWorkspaces.update({
          folderWorkspaceId: workspace.id,
          updates: { workspaceStatus: 'in-progress' }
        })
        ids.push(`folder:${workspace.id}`)
      }
      return ids
    }, folders)
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 })
    await page.waitForFunction(() => Boolean(window.api))
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

    const targetPane = page.locator(`[data-workspace-surface-id="${ids[0]}"][aria-hidden="false"]`)
    const partnerPane = page.locator(`[data-workspace-surface-id="${ids[1]}"][aria-hidden="false"]`)
    const readTargetStatus = (activePage: Page): Promise<string | null> =>
      activePage.evaluate(async (targetId) => {
        const id = targetId.slice('folder:'.length)
        return (
          (await window.api.folderWorkspaces.list()).find((workspace) => workspace.id === id)
            ?.workspaceStatus ?? null
        )
      }, ids[0])
    const restoreSplit = async () => {
      await page.evaluate(
        ([targetId, partnerId]) =>
          localStorage.setItem(
            'orca.workspaceSplitGroups.v2',
            JSON.stringify([
              {
                id: 'workspace-close-split',
                layout: {
                  type: 'split',
                  direction: 'horizontal',
                  ratio: 0.5,
                  first: { type: 'leaf', workspaceId: targetId },
                  second: { type: 'leaf', workspaceId: partnerId }
                }
              }
            ])
          ),
        ids
      )
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 })
      await expect(targetPane).toBeVisible()
      await expect(partnerPane).toBeVisible()
    }

    await restoreSplit()
    expect(await readTargetStatus(page)).toBe('in-progress')

    // No removes the pane without changing the workspace status.
    await targetPane.getByRole('button', { name: 'Close workspace', exact: true }).click()
    let dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'No', exact: true }).click()
    await expect(targetPane).toHaveCount(0)
    await expect(partnerPane).toBeVisible()
    expect(await readTargetStatus(page)).toBe('in-progress')

    // The dialog titlebar X has the same non-Done split-removal behavior.
    await restoreSplit()
    await targetPane.getByRole('button', { name: 'Close workspace', exact: true }).click()
    dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(targetPane).toHaveCount(0)
    await expect(partnerPane).toBeVisible()
    expect(await readTargetStatus(page)).toBe('in-progress')

    // Yes marks the workspace Done and the exact production state survives restart.
    await restoreSplit()
    await targetPane.getByRole('button', { name: 'Close workspace', exact: true }).click()
    dialog = page.getByRole('dialog')
    await expect(
      dialog.getByText('Mark all chats in this workspace as Done?', { exact: true })
    ).toBeVisible()
    await expect(
      dialog.getByText('The workspace will be removed from this window.', { exact: true })
    ).toBeVisible()
    await dialog.getByRole('button', { name: 'Yes', exact: true }).click()
    await expect(targetPane).toHaveCount(0)
    await expect(partnerPane).toBeVisible()
    await expect.poll(() => readTargetStatus(page)).toBe('completed')
    await captureHiddenRendererScreenshot(page, testInfo.outputPath('workspace-close-done.png'))

    await closeElectronAppForE2E(app)
    app = null
    const second = await launchPackaged(executablePath!, isolation.env)
    app = second.app
    await expect.poll(() => readTargetStatus(second.page), { timeout: 60_000 }).toBe('completed')
    await expect(
      second.page.locator(`[data-workspace-surface-id="${ids[0]}"][aria-hidden="false"]`)
    ).toHaveCount(0)
    await expect(
      second.page.locator(`[data-workspace-surface-id="${ids[1]}"][aria-hidden="false"]`)
    ).toBeVisible()
    await captureHiddenRendererScreenshot(
      second.page,
      testInfo.outputPath('workspace-close-done-after-restart.png')
    )
  } finally {
    try {
      if (app) {
        await closeElectronAppForE2E(app)
      }
    } finally {
      await cleanupE2EDaemons(profilePath)
    }
  }
})
