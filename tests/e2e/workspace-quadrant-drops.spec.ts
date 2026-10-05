import { expect, test } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'
import { retryTransientMainEvaluate } from './helpers/electron-main-evaluate-retry'

test('terminal tab drags reach all four quadrants and preserve full-window edges', async ({
  orcaPage,
  electronApp
}, info) => {
  test.setTimeout(360_000)
  await retryTransientMainEvaluate(() =>
    electronApp.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.setBackgroundThrottling(false)
        window.setContentSize(1100, 1200)
      }
    })
  )
  await waitForSessionReady(orcaPage)
  const ids = await orcaPage.evaluate(async () => {
    const s = window.__store!.getState()
    const original = Object.values(s.worktreesByRepo).flat()[0]
    const group = await window.api.projectGroups.create({
      name: 'Quadrant smoke folder',
      parentPath: original.path
    })
    await s.fetchProjectGroups()
    const ids: { workspace: string; tab: string }[] = []
    for (const name of ['Dragged chat', 'Destination chat', 'Retained chat']) {
      const folder = await s.createFolderWorkspace({
        projectGroupId: group.id,
        folderPath: original.path,
        name
      })
      if (!folder) {
        throw new Error('Could not create quadrant smoke workspace')
      }
      const workspace = `folder:${folder.id}`
      const tab = s.createTab(workspace)
      s.setAiVaultTabTitle(tab.id, { agent: 'codex', sessionId: tab.id, title: name })
      ids.push({ workspace, tab: tab.id })
    }
    await s.updateSettings({ theme: 'dark', chatSidebar: { view: 'chats', groupBy: 'status' } })
    s.setActiveView('terminal')
    return ids
  })
  const [source, target, retained] = ids
  const surface = (id: string) => orcaPage.locator(`[data-workspace-surface-id="${id}"]`)
  const tabsBefore = await orcaPage.evaluate(() =>
    Object.values(window.__store!.getState().tabsByWorktree)
      .flat()
      .map((tab) => tab.id)
      .sort()
  )
  const identities = () =>
    orcaPage.evaluate(async (ids) => {
      const s = window.__store!.getState()
      const ptys = (await window.api.pty.listSessions()).map((pty) => ({
        id: pty.id,
        worktreeId: pty.worktreeId
      }))
      return ids.map(({ workspace, tab }) => ({
        workspace,
        tab: s.tabsByWorktree[workspace]?.find((item) => item.id === tab)?.id,
        group: s.unifiedTabsByWorktree[workspace]?.find((item) => item.id === tab)?.groupId,
        terminals: (s.ptyIdsByTabId[tab] ?? []).map((id) => ptys.find((pty) => pty.id === id))
      }))
    }, ids)
  for (const side of ['left', 'right'] as const) {
    for (const edge of ['top', 'bottom'] as const) {
      for (const atOuterSide of [false, true]) {
        await orcaPage.evaluate(
          ({ ids, side }) => {
            const s = window.__store!.getState(),
              [a, b, c] = ids
            window.__store!.setState({ workspaceSplitGroups: [] })
            s.placeWorkspaceAtEdge(b.workspace, a.workspace, side)
            s.placeWorkspaceAtEdge(c.workspace, a.workspace, 'bottom')
            s.setActiveWorktree(a.workspace)
          },
          { ids, side }
        )
        await expect(surface(target.workspace)).toBeVisible()
        await expect
          .poll(() =>
            orcaPage.evaluate(
              (ids) =>
                ids.every(
                  ({ tab }) => (window.__store!.getState().ptyIdsByTabId[tab]?.length ?? 0) > 0
                ),
              ids
            )
          )
          .toBe(true)
        const before = await identities()
        const destination = await surface(target.workspace).boundingBox()
        const tab = await orcaPage.locator(`[data-tab-id="${source.tab}"]:visible`).boundingBox()
        await orcaPage.mouse.move(tab!.x + 40, tab!.y + 16)
        await orcaPage.mouse.down()
        await orcaPage.mouse.move(
          atOuterSide
            ? destination!.x + (side === 'left' ? 8 : destination!.width - 8)
            : destination!.x + destination!.width / 2,
          destination!.y + destination!.height * (edge === 'top' ? 0.15 : 0.85),
          { steps: 16 }
        )
        const preview = surface(target.workspace).locator('[data-workspace-drop-edge]:visible')
        await expect(preview).toHaveAttribute('data-workspace-drop-edge', edge)
        await expect(orcaPage.locator('[data-workspace-window-drop]:visible')).toHaveCount(0)
        const overlay = await preview.boundingBox()
        expect(Math.abs(overlay!.width - destination!.width)).toBeLessThan(3)
        expect(Math.abs(overlay!.height - destination!.height / 2)).toBeLessThan(3)
        await orcaPage.screenshot({
          path: info.outputPath(`${edge}-${side}-${atOuterSide}-preview.png`)
        })
        await orcaPage.mouse.up()
        await expect
          .poll(async () => {
            const a = await surface(source.workspace).boundingBox()
            const b = await surface(target.workspace).boundingBox()
            return Boolean(
              a &&
              b &&
              Math.abs(a.x - b.x) < 3 &&
              (edge === 'top' ? a.y + a.height <= b.y + 3 : b.y + b.height <= a.y + 3)
            )
          })
          .toBe(true)
        await expect(surface(retained.workspace)).toBeVisible()
        expect(await identities()).toEqual(before)
        await expect(orcaPage.locator('[data-chat-split-bracket]')).toHaveCount(3)
        await orcaPage.screenshot({
          path: info.outputPath(`${edge}-${side}-${atOuterSide}-result.png`)
        })
      }
    }
  }
  const root = await orcaPage.locator('[data-workspace-split-root]').boundingBox()
  const tab = await orcaPage.locator(`[data-tab-id="${source.tab}"]:visible`).boundingBox()
  await orcaPage.mouse.move(tab!.x + 40, tab!.y + 16)
  await orcaPage.mouse.down()
  await orcaPage.mouse.move(root!.x + root!.width - 8, root!.y + root!.height / 2, { steps: 16 })
  await expect(orcaPage.locator('[data-workspace-window-drop="right"]:visible')).toHaveCount(1)
  await orcaPage.mouse.up()
  await expect
    .poll(() => orcaPage.evaluate(() => window.__store!.getState().workspaceSplitGroups[0].layout))
    .toMatchObject({ direction: 'horizontal', second: { workspaceId: source.workspace } })
  expect(
    await orcaPage.evaluate(() =>
      Object.values(window.__store!.getState().tabsByWorktree)
        .flat()
        .map((tab) => tab.id)
        .sort()
    )
  ).toEqual(tabsBefore)
})
