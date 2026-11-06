import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test, type Page } from '@stablyai/playwright-test'
import { Terminal } from '@xterm/headless'
import { getE2ECompletedOnboardingProfile } from './helpers/e2e-completed-onboarding-profile'
import { createElectronHomeIsolation } from './helpers/electron-home-isolation'
import { cleanupE2EDaemons, closeElectronAppForE2E } from './helpers/electron-process-shutdown'
import { assertPackagedExecutableIdentity } from './helpers/packaged-executable-identity'
import { retryTransientMainEvaluate } from './helpers/electron-main-evaluate-retry'
import { captureHiddenRendererScreenshot } from './helpers/hidden-renderer-screenshot'

// Why: reproduces the November 2 report. A file opened from a chat must become a tab in the
// pane it was acted from, in this window, beside the chat. Modelled on
// packaged-file-link-workspace-smoke.spec.ts. This still needs execution against the reviewed
// package; static checks alone are not acceptance evidence.

/** Clicks a printed file path in the visible terminal, the same way the existing smoke does. */
async function clickPrintedFileLink(
  page: Page,
  printedPath: string,
  worktreeId: string
): Promise<void> {
  const snapshot = async () =>
    page.evaluate(async (owner) => {
      const session = (await window.api.pty.listSessions()).find(
        (item) => item.worktreeId === owner || item.id.startsWith(`${owner}@@`)
      )
      return session
        ? window.api.pty.getMainBufferSnapshot(session.id, { scrollbackRows: 100 })
        : null
    }, worktreeId)
  await expect
    .poll(async () => (await snapshot())?.data.split(printedPath).length ?? 0, { timeout: 20_000 })
    .toBeGreaterThanOrEqual(2)
  const frame = await snapshot()
  if (!frame) {
    throw new Error('Terminal snapshot unavailable')
  }
  const terminal = new Terminal({ cols: frame.cols, rows: frame.rows })
  await new Promise<void>((resolve) => terminal.write(frame.data, resolve))
  const buffer = terminal.buffer.active
  const visibleRows = Array.from({ length: frame.rows }, (_, row) =>
    (buffer.getLine(buffer.viewportY + row)?.translateToString(false) ?? '').padEnd(frame.cols)
  )
  terminal.dispose()
  // A long test output path can wrap at the terminal boundary. Search the fixed-width rendered
  // viewport as one buffer so the click target remains stable for both single-row and wrapped
  // links.
  const renderedViewport = visibleRows.join('')
  const start = renderedViewport.lastIndexOf(printedPath)
  if (start === -1) {
    throw new Error(`Terminal did not render a line containing ${printedPath}`)
  }
  const center = start + Math.floor(printedPath.length / 2)
  const screen = await page.locator('.xterm:visible .xterm-screen').boundingBox()
  if (!screen) {
    throw new Error('Visible terminal screen unavailable')
  }
  const point = {
    x: screen.x + ((center % frame.cols) + 0.5) * (screen.width / frame.cols),
    y: screen.y + (Math.floor(center / frame.cols) + 0.5) * (screen.height / frame.rows)
  }
  await captureHiddenRendererScreenshot(page, test.info().outputPath('link-probe.png'))
  await page.mouse.move(point.x, point.y)
  await expect(
    page.locator('.pane-link-tooltip:visible').filter({ hasText: 'partner-plan.md' })
  ).toBeVisible()
  await page.mouse.click(point.x, point.y)
  const popover = page.locator('[data-terminal-link-action-popover]')
  await expect(popover).toBeVisible()
  await popover.getByRole('button', { name: /Open file/i }).click()
}

test('a file opened from a chat or the plus menu lands in the acting pane', async (// oxlint-disable-next-line no-empty-pattern -- Playwright requires a destructured fixture argument.
{}, testInfo) => {
  const executablePath = process.env.ORCA_SMOKE_EXECUTABLE
  test.skip(!executablePath, 'Set ORCA_SMOKE_EXECUTABLE to the packaged Orca executable')
  // Why: packaged startup plus two terminal-to-editor placement flows need more than the default.
  test.setTimeout(240_000)
  const userDataDir = testInfo.outputPath('profile')
  const workspaceFolder = path.join(userDataDir, 'audit-workspace')
  // Keep the absolute link short enough to occupy one terminal row while retaining spaces, which
  // are the important regression condition for the absolute-path resolver.
  const outsideFolder = mkdtempSync(path.join(tmpdir(), 'Orca link '))
  mkdirSync(workspaceFolder, { recursive: true })
  mkdirSync(outsideFolder, { recursive: true })
  const outsideFile = path.join(outsideFolder, 'partner-plan.md')
  writeFileSync(outsideFile, '# Partner plan outside the worktree\n')
  writeFileSync(path.join(workspaceFolder, 'posting.md'), '# Posting pane file\n')
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
    await assertPackagedExecutableIdentity(app, executablePath)
    const page = await app.firstWindow()
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

    const worktreeId = await page.evaluate(async (folderPath) => {
      const group = await window.api.projectGroups.create({
        name: 'Acting pane smoke',
        parentPath: folderPath
      })
      const folder = await window.api.folderWorkspaces.create({
        projectGroupId: group.id,
        folderPath,
        name: 'Audit workspace'
      })
      return `folder:${folder.id}`
    }, workspaceFolder)
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 })
    await page.waitForFunction(() => Boolean(window.api))
    await page
      .locator(`[role="option"][data-worktree-id="${worktreeId}"] [data-worktree-card-surface]`)
      .click()
    await expect(page.locator(`[role="option"][data-worktree-id="${worktreeId}"]`)).toHaveAttribute(
      'aria-current',
      'page'
    )
    await expect
      .poll(() => page.evaluate(async () => (await window.api.pty.listSessions()).length), {
        timeout: 30_000
      })
      .toBe(1)
    await expect(
      page.locator(`[data-workspace-surface-id="${worktreeId}"] .xterm:visible`)
    ).toHaveCount(1, { timeout: 30_000 })

    // Entry 1: a terminal file link printed in the chat, then Open file in the popover.
    // Expected: a tab for partner-plan.md in the same pane as the chat terminal.
    // Terminal overlays intentionally live at the workspace surface, outside the group body.
    // This fixture starts with one group, so that sole body is the acting pane for the terminal.
    const visibleChatPane = page
      .locator(`[data-workspace-surface-id="${worktreeId}"] [data-tab-group-body-id]`)
      .first()
    const chatPaneId = await visibleChatPane.getAttribute('data-tab-group-body-id')
    expect(chatPaneId).toBeTruthy()
    // Why: opening the editor hides the terminal, so a locator filtered by a visible xterm would
    // stop matching the originating pane precisely when the placement assertion runs.
    const chatPane = page.locator(`[data-workspace-tab-group-id="${chatPaneId}"]`)
    await page.locator('.xterm:visible .xterm-helper-textarea').click()
    const printedOutsideFile = outsideFile.replaceAll('\\', '/')
    await page.keyboard.type(`Write-Output '${printedOutsideFile.replaceAll("'", "''")}'`)
    await page.keyboard.press('Enter')
    await clickPrintedFileLink(page, printedOutsideFile, worktreeId)
    await expect(
      chatPane.locator('[data-tab-id]').filter({ hasText: 'partner-plan.md' })
    ).toBeVisible()

    // Entry 2: the plus button on the chat pane, then the absolute path in the create entry.
    // Expected: a second tab in that same pane, not a new window or a sibling workspace.
    await chatPane.getByRole('button', { name: 'New tab', exact: true }).click()
    const entry = page.locator('input[role="combobox"][aria-autocomplete="list"]')
    await expect(entry).toBeVisible()
    await entry.fill(path.join(workspaceFolder, 'posting.md'))
    await entry.press('Enter')
    await expect(chatPane.locator('[data-tab-id]').filter({ hasText: 'posting.md' })).toHaveCount(1)

    await expect(page.locator(`[role="option"][data-worktree-id="${worktreeId}"]`)).toHaveAttribute(
      'aria-current',
      'page'
    )
    await captureHiddenRendererScreenshot(page, testInfo.outputPath('acting-pane.png'))
    expect(errors).toEqual([])
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
  } finally {
    await closeElectronAppForE2E(app)
    await cleanupE2EDaemons(userDataDir)
    rmSync(outsideFolder, { recursive: true, force: true })
  }
})
