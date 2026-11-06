import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { _electron as electron, test, expect } from '@stablyai/playwright-test'
import { getE2ECompletedOnboardingProfile } from './helpers/e2e-completed-onboarding-profile'
import { createElectronHomeIsolation } from './helpers/electron-home-isolation'
import { cleanupE2EDaemons, closeElectronAppForE2E } from './helpers/electron-process-shutdown'
import { retryTransientMainEvaluate } from './helpers/electron-main-evaluate-retry'
import { assertPackagedExecutableIdentity } from './helpers/packaged-executable-identity'
import { captureHiddenRendererScreenshot } from './helpers/hidden-renderer-screenshot'

// Why: the Hide Chats and Collapse Folders menus replace the single Done toggles. A profile saved
// before the menus existed (legacy showOnlyInProgress and collapseDoneFolders flags) must open with
// both Done states checked in each menu, and checking Idle must update the filter button state.
// Labels come from ChatSidebarOptions.tsx; the options trigger is found by its aria-label prefix.
// NOT RUN: written for the r7 packaged build. Selectors must be confirmed on the first live run.

const LEGACY_FILTER_LABEL = /^Chat grouping and folder filters/

test('Hide Chats and Collapse Folders menus show legacy Done flags as both Done states', async (// oxlint-disable-next-line no-empty-pattern -- Playwright requires a destructured fixture argument.
{}, testInfo) => {
  const executablePath = process.env.ORCA_SMOKE_EXECUTABLE
  test.skip(!executablePath, 'Set ORCA_SMOKE_EXECUTABLE to the packaged Orca executable')
  test.setTimeout(180_000)
  const userDataDir = testInfo.outputPath('profile')
  mkdirSync(userDataDir, { recursive: true })
  const profile = getE2ECompletedOnboardingProfile()
  writeFileSync(
    path.join(userDataDir, 'orca-data.json'),
    JSON.stringify({
      ...profile,
      settings: {
        ...profile.settings,
        chatSidebar: {
          view: 'chats',
          groupBy: 'folder',
          // Legacy-only: no hideChats or collapseFolders objects were ever saved.
          showOnlyInProgress: true,
          collapseDoneFolders: true
        }
      }
    })
  )
  const { ELECTRON_RUN_AS_NODE: _unused, ...inheritedEnv } = process.env
  void _unused
  const isolation = createElectronHomeIsolation({
    inheritedEnv,
    launchEnv: {},
    extraEnv: {},
    userDataDir
  })
  const app = await electron.launch({
    executablePath,
    args: [],
    env: { ...isolation.env, ORCA_BACKGROUND_LAUNCH: '1', ORCA_E2E_HEADLESS: '1' }
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
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))

    const filterButton = page.getByRole('button', { name: LEGACY_FILTER_LABEL })
    await expect(filterButton).toBeVisible({ timeout: 30_000 })
    // Legacy flags are active, so the filter button must already show its active state.
    await expect(filterButton).toHaveAttribute('data-filters-active', 'true')
    await filterButton.click()

    // Hide Chats: legacy showOnlyInProgress maps to both Done states, Idle stays unchecked.
    await page.getByRole('menuitem', { name: 'Hide Chats' }).hover()
    const hideDoneClosed = page.getByRole('menuitemcheckbox', { name: 'Done Closed', exact: true })
    const hideDoneOpen = page.getByRole('menuitemcheckbox', { name: 'Done Open', exact: true })
    const hideIdle = page.getByRole('menuitemcheckbox', { name: 'Idle', exact: true })
    await expect(hideDoneClosed).toHaveAttribute('aria-checked', 'true')
    await expect(hideDoneOpen).toHaveAttribute('aria-checked', 'true')
    await expect(hideIdle).toHaveAttribute('aria-checked', 'false')

    // Checking Idle adds a third hidden state; the state must persist after the menu closes.
    await hideIdle.click()
    await expect(hideIdle).toHaveAttribute('aria-checked', 'true')

    // Collapse Folders: the legacy collapseDoneFolders flag maps to both Done states.
    await page.getByRole('menuitem', { name: 'Collapse Folders' }).hover()
    await expect(
      page.getByRole('menuitemcheckbox', { name: 'Done Closed', exact: true }).last()
    ).toHaveAttribute('aria-checked', 'true')
    await expect(
      page.getByRole('menuitemcheckbox', { name: 'Done Open', exact: true }).last()
    ).toHaveAttribute('aria-checked', 'true')
    await expect(
      page.getByRole('menuitemcheckbox', { name: 'Idle', exact: true }).last()
    ).toHaveAttribute('aria-checked', 'false')

    await captureHiddenRendererScreenshot(page, testInfo.outputPath('sidebar-menus.png'))
    await page.keyboard.press('Escape')
    await expect(filterButton).toHaveAttribute('data-filters-active', 'true')
    expect(errors).toEqual([])
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
  } finally {
    await closeElectronAppForE2E(app)
    await cleanupE2EDaemons(userDataDir)
  }
})
