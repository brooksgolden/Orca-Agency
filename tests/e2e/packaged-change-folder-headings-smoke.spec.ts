import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { _electron as electron, test, expect } from '@stablyai/playwright-test'
import { getE2ECompletedOnboardingProfile } from './helpers/e2e-completed-onboarding-profile'
import { createElectronHomeIsolation } from './helpers/electron-home-isolation'
import { cleanupE2EDaemons, closeElectronAppForE2E } from './helpers/electron-process-shutdown'
import { retryTransientMainEvaluate } from './helpers/electron-main-evaluate-retry'
import { assertPackagedExecutableIdentity } from './helpers/packaged-executable-identity'

// Why: Example User reported that the Change folder menu omitted the "Example Capital" sidebar heading,
// so a chat could not be moved to a folder he could see. This smoke asserts that every folder
// heading in the sidebar is also a Change folder destination.
//
// NOT RUN. Written against a packaged build that has not been produced for this change. The
// heading selector (button[data-chat-section], id chat:folder:<label>) and the row selector
// (data-chat-sidebar-id) come from SidebarChatList.tsx and ChatSidebarRow.tsx; the seeded chat
// and the menu role queries must be verified against the live DOM before the first run.

const HEADING_PREFIX = 'chat:folder:'

test('Change folder menu lists every sidebar folder heading', async (// oxlint-disable-next-line no-empty-pattern -- Playwright requires a destructured fixture argument.
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
        chatSidebar: { groupBy: 'folder' }
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

    // Seed two registered folders, each with a workspace, so the sidebar has at least two folder
    // headings to compare against the menu. Also register an unrelated standalone project. It has
    // no chat row or folder heading, so it must not leak into either folder picker.
    const folderPaths = ['Example Capital', 'Loose Heading'].map((name) =>
      path.join(userDataDir, name)
    )
    const unrelatedProjectPath = path.join(userDataDir, 'example-gtm-dashboard')
    const sessionIds = [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222'
    ]
    const transcripts = sessionIds.map((sessionId) => path.join(userDataDir, `${sessionId}.jsonl`))
    folderPaths.forEach((folder) => mkdirSync(folder, { recursive: true }))
    mkdirSync(unrelatedProjectPath, { recursive: true })
    transcripts.forEach((file, index) =>
      writeFileSync(
        file,
        `${JSON.stringify({ type: 'user', sessionId: sessionIds[index], cwd: folderPaths[index], timestamp: new Date().toISOString(), message: { role: 'user', content: 'Folder picker smoke transcript' } })}\n`
      )
    )
    await page.evaluate(
      async ({ folders, unrelatedProject, sessionIds, transcripts }) => {
        const group = await window.api.projectGroups.create({
          name: 'Example Capital',
          parentPath: folders[0]
        })
        const initioWorkspace = await window.api.folderWorkspaces.create({
          projectGroupId: group.id,
          folderPath: folders[0],
          name: 'Example Capital'
        })
        const looseGroup = await window.api.projectGroups.create({
          name: 'Loose Heading',
          parentPath: folders[1]
        })
        const looseWorkspace = await window.api.folderWorkspaces.create({
          projectGroupId: looseGroup.id,
          folderPath: folders[1],
          name: 'Loose Heading'
        })
        const added = await window.api.repos.add({ path: unrelatedProject, kind: 'folder' })
        if ('error' in added) {
          throw new Error(added.error)
        }
        const now = Date.now()
        const workspaces = [initioWorkspace, looseWorkspace]
        const titles = ['Research entrepreneurial newsletter', 'Loose folder chat']
        const settings = await window.api.settings.get()
        await window.api.settings.set({
          chatSidebar: {
            ...settings.chatSidebar,
            view: 'chats',
            groupBy: 'folder',
            sessions: Object.fromEntries(
              sessionIds.map((sessionId, index) => [
                JSON.stringify(['local', 'codex', sessionId]),
                {
                  worktreeId: `folder:${workspaces[index].id}`,
                  snapshot: {
                    executionHostId: 'local' as const,
                    executionHostPlatform: 'win32' as const,
                    agent: 'codex' as const,
                    sessionId,
                    title: titles[index],
                    cwd: folders[index],
                    filePath: transcripts[index],
                    codexHome: null,
                    createdAt: new Date(now - 60_000).toISOString(),
                    updatedAt: new Date(now - index * 1_000).toISOString(),
                    modifiedAt: new Date(now - index * 1_000).toISOString()
                  }
                }
              ])
            )
          }
        })
      },
      {
        folders: folderPaths,
        unrelatedProject: unrelatedProjectPath,
        sessionIds,
        transcripts
      }
    )
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 })

    // Open the real saved chat row in Example Capital so its context menu exists.
    const row = page
      .locator('[data-chat-sidebar-id]')
      .filter({ hasText: 'Research entrepreneurial newsletter' })
    await expect(row).toBeVisible({ timeout: 30_000 })
    await row.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Change folder' }).hover()

    const headingLabels = await page
      .locator(`button[data-chat-section^="${HEADING_PREFIX}"]`)
      .evaluateAll(
        (buttons, prefix) =>
          buttons.map((button) =>
            (button.getAttribute('data-chat-section') ?? '').slice(prefix.length)
          ),
        HEADING_PREFIX
      )
    expect(headingLabels).toContain('Example Capital')
    expect(headingLabels).toContain('Loose Heading')
    expect(headingLabels).not.toContain('example-gtm-dashboard')

    for (const label of headingLabels) {
      if (!label) {
        continue
      }
      await expect(page.getByRole('menuitem', { name: label, exact: true })).toBeVisible({
        timeout: 10_000
      })
    }
    await expect(
      page.getByRole('menuitem', { name: 'example-gtm-dashboard', exact: true })
    ).toHaveCount(0)
    await page.keyboard.press('Escape')

    await page.getByRole('button', { name: 'New workspace', exact: true }).click()
    const newChat = page.getByRole('dialog', { name: 'New chat', exact: true })
    const folderPicker = newChat.getByRole('combobox', { name: 'Folder', exact: true })
    await folderPicker.click()
    await expect(page.getByRole('option', { name: 'Example Capital', exact: true })).toBeVisible()
    await expect(page.getByRole('option', { name: 'Loose Heading', exact: true })).toBeVisible()
    await expect(
      page.getByRole('option', { name: 'example-gtm-dashboard', exact: true })
    ).toHaveCount(0)
    await page.keyboard.press('Escape')
    await newChat.getByRole('button', { name: 'Close', exact: true }).click()
  } finally {
    await closeElectronAppForE2E(app)
    await cleanupE2EDaemons(userDataDir)
  }
})
