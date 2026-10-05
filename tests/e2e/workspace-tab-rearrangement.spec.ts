import { expect, test } from './helpers/orca-app'

test('terminal tabs rearrange bottom and outer right panes without losing conversations', async ({
  orcaPage
}, info) => {
  test.setTimeout(180_000)
  const ids = await orcaPage.evaluate(async () => {
    const s = window.__store!.getState()
    const workspaces = Object.values(s.worktreesByRepo).find((rows) => rows.length >= 2)!
    const [a, b] = workspaces
    const first = s.tabsByWorktree[a.id]?.[0] ?? s.createTab(a.id)
    const second = s.tabsByWorktree[b.id]?.[0] ?? s.createTab(b.id)
    s.setAiVaultTabTitle(first.id, { agent: 'codex', sessionId: first.id, title: 'Main chat' })
    s.setAiVaultTabTitle(second.id, { agent: 'claude', sessionId: second.id, title: 'Second chat' })
    await s.createProjectGroup('Test Folder', { parentPath: a.path, hostId: 'local' })
    await s.updateSettings({ theme: 'dark', chatSidebar: { view: 'chats', groupBy: 'status' } })
    s.setActiveWorktree(a.id)
    s.setActiveView('terminal')
    s.placeWorkspaceAtEdge(b.id, a.id, 'bottom')
    return { a: a.id, b: b.id, first: first.id, second: second.id }
  })
  const surface = (id: string) => orcaPage.locator(`[data-workspace-surface-id="${id}"]`)
  const tab = (id: string) => orcaPage.locator(`[data-tab-id="${id}"]:visible`)
  await expect(surface(ids.b)).toBeVisible()
  async function drag(id: string, x: number, y: number) {
    const box = await tab(id).boundingBox()
    await orcaPage.mouse.move(box!.x + 40, box!.y + 15)
    await orcaPage.mouse.down()
    await orcaPage.mouse.move(x, y, { steps: 16 })
    await expect(
      orcaPage.locator('[data-workspace-window-drop]:visible, [data-workspace-drop-edge]:visible')
    ).toHaveCount(1)
    await orcaPage.mouse.up()
  }
  const root = await orcaPage.locator('[data-workspace-split-root]').boundingBox()
  await drag(ids.second, root!.x + root!.width - 8, root!.y + root!.height / 2)
  await expect
    .poll(() => orcaPage.evaluate(() => window.__store!.getState().workspaceSplitGroups[0].layout))
    .toMatchObject({
      type: 'split',
      direction: 'horizontal',
      second: { type: 'leaf', workspaceId: ids.b }
    })
  await expect
    .poll(async () => {
      const a = await surface(ids.a).boundingBox(),
        b = await surface(ids.b).boundingBox()
      return Boolean(a && b && b.x >= a.x + a.width - 3 && Math.abs(b.y - a.y) < 3)
    })
    .toBe(true)
  const left = await surface(ids.a).boundingBox()
  await drag(ids.second, left!.x + left!.width / 2, left!.y + left!.height - 8)
  await expect
    .poll(() => orcaPage.evaluate(() => window.__store!.getState().workspaceSplitGroups[0].layout))
    .toMatchObject({
      type: 'split',
      direction: 'vertical',
      second: { type: 'leaf', workspaceId: ids.b }
    })
  await expect
    .poll(async () => {
      const a = await surface(ids.a).boundingBox(),
        b = await surface(ids.b).boundingBox()
      return Boolean(a && b && b.y >= a.y + a.height - 3 && Math.abs(b.x - a.x) < 3)
    })
    .toBe(true)
  await orcaPage.screenshot({ path: info.outputPath('bottom-tab-drag.png') })
  const child = await orcaPage.evaluate((a) => {
    const s = window.__store!.getState(),
      child = s.createTab(a)
    s.setAiVaultTabTitle(child.id, { agent: 'claude', sessionId: child.id, title: 'Nested chat' })
    return child.id
  }, ids.a)
  await expect(tab(child)).toBeVisible()
  const sidebarChild = orcaPage.locator('[data-chat-sidebar-id]').filter({ hasText: 'Nested chat' })
  await expect(sidebarChild).toHaveAttribute('data-chat-sub-tab', 'true')
  await expect
    .poll(() =>
      orcaPage.evaluate(
        (child) => window.__store!.getState().ptyIdsByTabId[child]?.length ?? 0,
        child
      )
    )
    .toBeGreaterThan(0)
  const childPtys = await orcaPage.evaluate(
    (child) => window.__store!.getState().ptyIdsByTabId[child],
    child
  )
  const content = () =>
    orcaPage.evaluate((child) => {
      const buffer = window.__paneManagers?.get(child)?.getActivePane?.()?.terminal.buffer.active
      return buffer
        ? Array.from(
            { length: buffer.length },
            (_, i) => buffer.getLine(i)?.translateToString() ?? ''
          ).join('\n')
        : ''
    }, child)
  // A recorded PTY ID alone does not prove its shell has finished starting.
  await expect.poll(content, { timeout: 20_000 }).toMatch(/\S/)
  await orcaPage.evaluate(
    (ptyId) => window.api.pty.write(ptyId, 'echo MOVE_BEFORE_742\r', 'driving'),
    childPtys[0]
  )
  await expect.poll(content, { timeout: 20_000 }).toContain('MOVE_BEFORE_742')
  const originalManager = await orcaPage.evaluateHandle(
    (child) => window.__paneManagers?.get(child),
    child
  )
  const destination = await surface(ids.b).boundingBox()
  await drag(
    child,
    destination!.x + destination!.width / 2,
    destination!.y + destination!.height * 0.85
  )
  await expect
    .poll(() =>
      orcaPage.evaluate(
        (child) =>
          Object.entries(window.__store!.getState().tabsByWorktree).find(([, tabs]) =>
            tabs.some((tab) => tab.id === child)
          )?.[0],
        child
      )
    )
    .not.toBe(ids.a)
  const moved = await orcaPage.evaluate(
    (child) =>
      Object.values(window.__store!.getState().tabsByWorktree)
        .flat()
        .find((tab) => tab.id === child),
    child
  )
  expect(moved!.aiVaultTitle!.sessionId).toBe(child)
  await expect(sidebarChild).not.toHaveAttribute('data-chat-sub-tab', 'true')
  await expect(sidebarChild).toHaveAttribute('data-chat-completed', 'false')
  await expect
    .poll(() =>
      orcaPage.evaluate(
        ({ child, original }) => {
          const current = window.__paneManagers?.get(child)
          return Boolean(current && current !== original)
        },
        { child, original: originalManager }
      )
    )
    .toBe(true)
  await expect
    .poll(() =>
      orcaPage.evaluate((child) => window.__store!.getState().ptyIdsByTabId[child], child)
    )
    .toEqual(childPtys)
  await expect.poll(content, { timeout: 20_000 }).toContain('MOVE_BEFORE_742')
  await orcaPage.evaluate(
    (ptyId) => window.api.pty.write(ptyId, 'echo MOVE_AFTER_742\r', 'driving'),
    childPtys[0]
  )
  await expect.poll(content, { timeout: 20_000 }).toContain('MOVE_AFTER_742')
  await expect
    .poll(
      async () => {
        const output = await content()
        return output.includes('MOVE_BEFORE_742') && output.includes('MOVE_AFTER_742')
      },
      { timeout: 20_000 }
    )
    .toBe(true)
  await originalManager.dispose()
  await orcaPage.screenshot({ path: info.outputPath('separate-chat.png') })
})
