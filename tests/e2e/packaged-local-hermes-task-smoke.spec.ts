import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { _electron as electron, expect, test } from '@stablyai/playwright-test'
import { getE2ECompletedOnboardingProfile } from './helpers/e2e-completed-onboarding-profile'
import { createElectronHomeIsolation } from './helpers/electron-home-isolation'
import { cleanupE2EDaemons, closeElectronAppForE2E } from './helpers/electron-process-shutdown'
import { assertPackagedExecutableIdentity } from './helpers/packaged-executable-identity'

test('packaged local Hermes scheduled task appears in Automations', async (// oxlint-disable-next-line no-empty-pattern -- Playwright requires a destructured fixture argument.
{}, testInfo) => {
  const executablePath = process.env.ORCA_SMOKE_EXECUTABLE
  const hermesHome = process.env.ORCA_SMOKE_HERMES_HOME
  if (!executablePath || !hermesHome) {
    test.skip(true, 'Set the packaged Orca and Hermes home paths')
    return
  }
  test.setTimeout(180_000)

  const userDataDir = testInfo.outputPath('profile')
  mkdirSync(userDataDir, { recursive: true })
  writeFileSync(
    path.join(userDataDir, 'orca-data.json'),
    JSON.stringify(getE2ECompletedOnboardingProfile())
  )
  const { ELECTRON_RUN_AS_NODE: _unused, ...inheritedEnv } = process.env
  void _unused
  const isolation = createElectronHomeIsolation({
    inheritedEnv,
    launchEnv: {},
    extraEnv: { HERMES_HOME: hermesHome },
    userDataDir
  })
  const app = await electron.launch({
    executablePath,
    args: [],
    env: { ...isolation.env, ORCA_BACKGROUND_LAUNCH: '1', ORCA_E2E_HEADLESS: '1' }
  })
  try {
    await assertPackagedExecutableIdentity(app, executablePath)
    const page = await app.firstWindow()
    await app.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.setBackgroundThrottling(false)
      }
    })
    await page.waitForFunction(() => Boolean(window.api))
    const navigation = page.getByRole('button', { name: 'Automations', exact: true })
    await expect(navigation).toBeVisible()
    await expect(navigation).toBeEnabled()
    // Why: hidden Electron windows can stop the animation frames Playwright's pointer check awaits.
    await navigation.dispatchEvent('click')
    await expect(page.getByRole('heading', { name: 'Automations', exact: true })).toBeVisible()
    const name = page.getByText('Hermes workspace mirror', { exact: true })
    await expect(name).toBeVisible({ timeout: 60_000 })
    const row = name.locator('xpath=ancestor::*[@role="button"][1]')
    await expect(row).toContainText('Every 15 minutes')
    await expect(row).toContainText('this computer')
  } finally {
    await closeElectronAppForE2E(app)
    await cleanupE2EDaemons(userDataDir)
  }
})
