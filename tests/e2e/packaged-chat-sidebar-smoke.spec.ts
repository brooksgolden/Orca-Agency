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
    await app.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.setBackgroundThrottling(false)
      }
    })
    await page.waitForFunction(() => Boolean(window.api))
    expect(await page.evaluate(() => Boolean(window.__store))).toBe(false)
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    const folder = path.join(userDataDir, 'agency-project')
    mkdirSync(folder, { recursive: true })
    const nextFolder = path.join(userDataDir, 'local-tools')
    mkdirSync(nextFolder, { recursive: true })
    const capture = path.join(folder, 'resume-capture.txt')
    const stub = path.join(folder, 'claude-smoke.cmd')
    writeFileSync(stub, `@echo off\r\necho %CD% ^| %* >> "${capture}"\r\n`)
    const ids = [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333'
    ]
    const projectBucket = path.join(userDataDir, 'projects', 'original-folder')
    mkdirSync(projectBucket, { recursive: true })
    const transcripts = ids.map((id) => path.join(projectBucket, `${id}.jsonl`))
    transcripts.forEach((file, index) =>
      writeFileSync(
        file,
        `${JSON.stringify({ type: 'user', sessionId: ids[index], cwd: folder, timestamp: new Date().toISOString(), message: { role: 'user', content: 'Smoke transcript only' } })}\n`
      )
    )
    await page.evaluate(
      async ({ folder, nextFolder, ids, transcripts, stub }) => {
        await window.api.projectGroups.create({ name: 'Local tools', parentPath: nextFolder })
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
                title:
                  index === 0
                    ? 'Latest client research'
                    : index === 1
                      ? 'Earlier client draft'
                      : 'Scheduled audit',
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
          terminalWindowsShell: 'powershell.exe',
          terminalWindowsPowerShellImplementation: 'powershell.exe',
          agentCmdOverrides: { claude: `& '${stub.replaceAll("'", "''")}'` },
          chatSidebar: {
            view: 'chats',
            groupBy: 'status',
            sessions,
            automationChats: [JSON.stringify(['local', 'claude', ids[2]])]
          }
        })
      },
      { folder, nextFolder, ids, transcripts, stub }
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
    await renamed.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Change folder', exact: true }).hover()
    await page.getByRole('menuitem', { name: 'Local tools', exact: true }).click()
    await expect(renamed).toContainText('Local tools')
    await expect(rows.filter({ hasText: 'Earlier client draft' })).toContainText('Client folder')
    await renamed.dblclick()
    await expect
      .poll(() => (existsSync(capture) ? readFileSync(capture, 'utf8') : ''), { timeout: 45_000 })
      .toContain(ids[0])
    const launched = readFileSync(capture, 'utf8').trim().split(/\r?\n/)
    expect(launched).toHaveLength(1)
    expect(launched[0]).toContain(nextFolder)
    expect(existsSync(transcripts[0])).toBe(true)
    await expect(rows).toHaveCount(2)
    await expect(renamed).toHaveAttribute('aria-selected', 'true')
    const generatedWorkspace = await page.evaluate(async (folder) => {
      const added = await window.api.repos.add({ path: folder, kind: 'folder' })
      if ('error' in added) {
        throw new Error(added.error)
      }
      const { worktree } = await window.api.worktrees.create({
        repoId: added.repo.id,
        name: 'coho',
        nameWasGenerated: true
      })
      const settings = await window.api.settings.get()
      const snapshot = Object.values(settings.chatSidebar?.sessions ?? {})[0].snapshot
      if (!snapshot) {
        throw new Error('Missing smoke session snapshot')
      }
      const sessionId = '44444444-4444-4444-8444-444444444444'
      await window.api.settings.set({
        chatSidebar: {
          ...settings.chatSidebar,
          sessions: {
            ...settings.chatSidebar?.sessions,
            [JSON.stringify(['local', 'claude', sessionId])]: {
              worktreeId: worktree.id,
              snapshot: { ...snapshot, sessionId, title: 'Set Krisp to record webinar' }
            }
          }
        }
      })
      return { id: worktree.id, mode: worktree.displayNameMode }
    }, folder)
    expect(generatedWorkspace.mode).toBe('automatic')
    await page.reload()
    await expect(rows.filter({ hasText: 'Set Krisp to record webinar' })).toBeVisible()
    await page.evaluate(async (worktreeId) => {
      await window.api.worktrees.updateMeta({ worktreeId, updates: { displayName: 'coho' } })
    }, generatedWorkspace.id)
    await page.reload()
    await expect(rows.filter({ hasText: 'coho' })).toBeVisible()
    await expect(rows.filter({ hasText: 'Set Krisp to record webinar' })).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath('packaged-chat-sidebar.png') })
    expect(errors).toEqual([])
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every((window) => !window.isVisible())
      )
    ).toBe(true)
  } catch (error) {
    const page = await app.firstWindow()
    await page.screenshot({ path: testInfo.outputPath('packaged-chat-failure.png') })
    const terminals = await page.evaluate(async () => {
      const sessions = await window.api.pty.listSessions()
      return Promise.all(
        sessions.map(async (session) => ({
          id: session.id,
          buffer: await window.api.pty.getMainBufferSnapshot(session.id, { scrollbackRows: 50 })
        }))
      )
    })
    writeFileSync(testInfo.outputPath('resume-terminals.json'), JSON.stringify(terminals, null, 2))
    throw error
  } finally {
    await closeElectronAppForE2E(app)
    await cleanupE2EDaemons(userDataDir)
  }
})
