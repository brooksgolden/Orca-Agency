import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { _electron as electron, test, expect } from '@stablyai/playwright-test'
import { getE2ECompletedOnboardingProfile } from './helpers/e2e-completed-onboarding-profile'
import { createElectronHomeIsolation } from './helpers/electron-home-isolation'
import { cleanupE2EDaemons, closeElectronAppForE2E } from './helpers/electron-process-shutdown'
import { retryTransientMainEvaluate } from './helpers/electron-main-evaluate-retry'

test('packaged chat sidebar restores closed chats and resumes one exact session', async (// oxlint-disable-next-line no-empty-pattern -- Playwright requires a destructured fixture argument.
{}, testInfo) => {
  const executablePath = process.env.ORCA_SMOKE_EXECUTABLE
  test.skip(!executablePath, 'Set ORCA_SMOKE_EXECUTABLE to the reviewed executable')
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
    extraEnv: {},
    userDataDir
  })
  const app = await electron.launch({
    executablePath,
    args: [],
    env: { ...isolation.env, ORCA_BACKGROUND_LAUNCH: '1', ORCA_E2E_HEADLESS: '1' }
  })
  try {
    expect(
      await retryTransientMainEvaluate(() => app.evaluate(({ app }) => app.getPath('home')))
    ).toBe(isolation.isolatedHome)
    expect(await retryTransientMainEvaluate(() => app.evaluate(({ app }) => app.isPackaged))).toBe(
      true
    )
    const page = await app.firstWindow()
    await page.waitForFunction(() => Boolean(window.api))
    expect(await page.evaluate(() => Boolean(window.__store))).toBe(false)
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    const folder = path.join(userDataDir, 'agency-project')
    mkdirSync(folder, { recursive: true })
    const capture = path.join(folder, 'resume-capture.txt')
    const stub = path.join(folder, 'claude-smoke.cmd')
    writeFileSync(stub, `@echo off\r\necho %CD% ^| %* >> "${capture}"\r\n`)
    const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222']
    const transcripts = ids.map((id) => path.join(folder, `${id}.jsonl`))
    transcripts.forEach((file, index) =>
      writeFileSync(
        file,
        `${JSON.stringify({ type: 'user', sessionId: ids[index], cwd: folder, timestamp: new Date().toISOString(), message: { role: 'user', content: 'Smoke transcript only' } })}\n`
      )
    )
    await page.evaluate(
      async ({ folder, ids, transcripts, stub }) => {
        const group = await window.api.projectGroups.create({
          name: 'Client folder',
          parentPath: folder
        })
        const workspace = await window.api.folderWorkspaces.create({
          projectGroupId: group.id,
          folderPath: folder,
          name: 'Client work'
        })
        const now = Date.now()
        const sessions = Object.fromEntries(
          ids.map((id, index) => [
            JSON.stringify(['local', 'claude', id]),
            {
              worktreeId: `folder:${workspace.id}`,
              snapshot: {
                executionHostId: 'local' as const,
                executionHostPlatform: 'win32' as const,
                agent: 'claude' as const,
                sessionId: id,
                title: index === 0 ? 'Latest client research' : 'Earlier client draft',
                cwd: folder,
                filePath: transcripts[index],
                codexHome: null,
                createdAt: new Date(now - 86_400_000).toISOString(),
                updatedAt: new Date(now - (index + 1) * 60_000).toISOString(),
                modifiedAt: new Date(now - (index + 1) * 60_000).toISOString()
              }
            }
          ])
        )
        // The stub records the real launch command and cwd without making an AI request.
        await window.api.settings.set({
          agentCmdOverrides: { claude: `"${stub}"` },
          chatSidebar: { view: 'chats', groupBy: 'status', sessions }
        })
      },
      { folder, ids, transcripts, stub }
    )
    await page.reload()
    const rows = page.locator('[data-chat-sidebar-id]')
    const latest = rows.filter({ hasText: 'Latest client research' })
    await expect(latest).toBeVisible()
    await expect(rows).toHaveCount(2)
    await expect(rows.first()).toContainText('Latest client research')
    await expect(latest).toContainText('Client folder')
    expect((await latest.boundingBox())?.height).toBe(44)
    await latest.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Rename chat', exact: true }).click()
    await page.getByRole('textbox', { name: 'Chat name', exact: true }).fill('Saved client name')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    const renamed = rows.filter({ hasText: 'Saved client name' })
    await renamed.getByRole('button', { name: 'Mark Saved client name done' }).click()
    await expect(renamed).toHaveAttribute('data-chat-completed', 'true')
    await page.reload()
    await expect(renamed).toBeVisible()
    await expect(renamed).toHaveAttribute('data-chat-completed', 'true')
    await renamed.getByRole('button', { name: 'Reopen Saved client name' }).click()
    await renamed.dblclick()
    await expect
      .poll(() => (existsSync(capture) ? readFileSync(capture, 'utf8') : ''), { timeout: 45_000 })
      .toContain(ids[0])
    const launched = readFileSync(capture, 'utf8').trim().split(/\r?\n/)
    expect(launched).toHaveLength(1)
    expect(launched[0]).toContain(folder)
    await expect(rows).toHaveCount(2)
    await expect(renamed).toHaveAttribute('aria-selected', 'true')
    await page.screenshot({ path: testInfo.outputPath('packaged-chat-sidebar.png') })
    expect(errors).toEqual([])
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every((window) => !window.isVisible())
      )
    ).toBe(true)
  } finally {
    await closeElectronAppForE2E(app)
    await cleanupE2EDaemons(userDataDir)
  }
})
