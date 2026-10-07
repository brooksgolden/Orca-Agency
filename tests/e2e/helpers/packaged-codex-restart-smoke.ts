import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, type Page } from '@stablyai/playwright-test'
import { normalizeRuntimePathForComparison } from '../../../src/shared/cross-platform-path'

/** Exercise the packaged main-process replacement guard without an AI request. */
export async function assertPackagedDefaultHomeCodexRestart(
  page: Page,
  isolatedHome: string,
  folder: string,
  worktreeId: string
): Promise<void> {
  if (process.platform !== 'win32') {
    return
  }
  const sessionId = '44444444-4444-4444-8444-444444444444'
  const secondSessionId = '55555555-5555-4555-8555-555555555555'
  const codexHome = path.join(isolatedHome, '.codex')
  const transcriptPath = path.join(
    codexHome,
    'sessions',
    '2026',
    '10',
    '07',
    `rollout-2026-10-07T00-00-00-${sessionId}.jsonl`
  )
  mkdirSync(path.dirname(transcriptPath), { recursive: true })
  writeFileSync(
    transcriptPath,
    `${JSON.stringify({ type: 'session_meta', payload: { id: sessionId, cwd: folder } })}\n`
  )
  const secondTranscript = transcriptPath.replaceAll(sessionId, secondSessionId)
  writeFileSync(
    secondTranscript,
    `${JSON.stringify({ type: 'session_meta', payload: { id: secondSessionId, cwd: folder } })}\n`
  )
  const stubDirectory = mkdtempSync(path.join(isolatedHome, 'restart-stub-'))
  const otherHome = path.join(stubDirectory, 'other-account')
  mkdirSync(otherHome)
  const capture = path.join(stubDirectory, 'capture.txt')
  const stub = path.join(stubDirectory, 'codex.cmd')
  writeFileSync(
    stub,
    `@echo off\r\necho %ORCA_SMOKE_CASE% ^| %USERPROFILE% ^| %CODEX_HOME% ^| %* >> "${capture}"\r\n`
  )
  const command = `& '${stub.replaceAll("'", "''")}'`
  const ownedPtyIds: string[] = []
  const captureLines = (): string[] => {
    try {
      return readFileSync(capture, 'utf8').split(/\r?\n/)
    } catch {
      return []
    }
  }
  const homeKey = (home: string): string =>
    normalizeRuntimePathForComparison(realpathSync.native(home))
  try {
    const original = await page.evaluate(
      ({ command, folder, worktreeId }) =>
        window.api.pty.spawn({
          cols: 80,
          rows: 24,
          cwd: folder,
          worktreeId,
          command: `${command} 'before-restart'`,
          startupCommandDelivery: 'shell-ready',
          launchAgent: 'codex',
          shellOverride: 'powershell.exe',
          initiallyHidden: true
        }),
      { command, folder, worktreeId }
    )
    ownedPtyIds.push(original.id)
    await expect
      .poll(() => captureLines().join('\n'), { timeout: 30_000 })
      .toContain('before-restart')
    const freshLine = captureLines().find((line) => line.includes('before-restart'))!
    const selectedFreshHome = freshLine.split('|')[2].trim()
    expect(homeKey(selectedFreshHome)).toBe(
      homeKey(path.join(path.dirname(isolatedHome), 'codex-runtime-home', 'home'))
    )
    expect(homeKey(selectedFreshHome)).not.toBe(homeKey(otherHome))
    const replacement = await page.evaluate(
      ({ command, folder, worktreeId, oldPtyId, sessionId, transcriptPath }) =>
        window.api.pty.spawn({
          cols: 80,
          rows: 24,
          cwd: folder,
          worktreeId,
          command: `${command} 'resume' '${sessionId}'`,
          startupCommandDelivery: 'shell-ready',
          launchAgent: 'codex',
          shellOverride: 'powershell.exe',
          replacesPtyId: oldPtyId,
          resumeProviderSession: { key: 'session_id', id: sessionId, transcriptPath },
          env: { ORCA_SMOKE_CASE: 'default-home' },
          initiallyHidden: true
        }),
      { command, folder, worktreeId, oldPtyId: original.id, sessionId, transcriptPath }
    )
    ownedPtyIds.push(replacement.id)
    expect(replacement.agentResumeUnavailable).not.toBe(true)
    expect(replacement.id).not.toBe(original.id)
    await expect
      .poll(() => captureLines().find((line) => line.startsWith('default-home ')) ?? '', {
        timeout: 30_000
      })
      .toContain(`resume ${sessionId}`)
    const defaultLine = captureLines().find((line) => line.startsWith('default-home '))!
    const [, actualUserHome, actualCodexHome] = defaultLine.split('|').map((value) => value.trim())
    expect(homeKey(actualUserHome)).toBe(homeKey(isolatedHome))
    if (actualCodexHome) {
      expect(homeKey(actualCodexHome)).toBe(homeKey(codexHome))
    }

    // The ordinary saved-chat path accepts this exact transcript/env and pins its origin.
    const control = await page.evaluate(
      ({ command, folder, worktreeId, secondSessionId, secondTranscript, otherHome }) =>
        window.api.pty.spawn({
          cols: 80,
          rows: 24,
          cwd: folder,
          worktreeId,
          command: `${command} 'resume' '${secondSessionId}'`,
          startupCommandDelivery: 'shell-ready',
          launchAgent: 'codex',
          shellOverride: 'powershell.exe',
          resumeProviderSession: {
            key: 'session_id',
            id: secondSessionId,
            transcriptPath: secondTranscript
          },
          env: { CODEX_HOME: otherHome, ORCA_CODEX_HOME: '', ORCA_SMOKE_CASE: 'ordinary-resume' },
          initiallyHidden: true
        }),
      { command, folder, worktreeId, secondSessionId, secondTranscript, otherHome }
    )
    ownedPtyIds.push(control.id)
    expect(control.agentResumeUnavailable).not.toBe(true)
    await expect
      .poll(() => captureLines().find((line) => line.startsWith('ordinary-resume ')) ?? '', {
        timeout: 30_000
      })
      .toContain(`resume ${secondSessionId}`)
    const controlLine = captureLines().find((line) => line.startsWith('ordinary-resume '))!
    expect(homeKey(controlLine.split('|')[2].trim())).toBe(homeKey(codexHome))
    await page.evaluate((id) => window.api.pty.kill(id), control.id)

    // This proves custom-home refusal, not the fresh launch's credential identity.
    const rejected = await page.evaluate(
      ({ command, folder, worktreeId, oldPtyId, secondSessionId, secondTranscript, otherHome }) =>
        window.api.pty.spawn({
          cols: 80,
          rows: 24,
          cwd: folder,
          worktreeId,
          command: `${command} 'resume' '${secondSessionId}'`,
          startupCommandDelivery: 'shell-ready',
          launchAgent: 'codex',
          shellOverride: 'powershell.exe',
          replacesPtyId: oldPtyId,
          resumeProviderSession: {
            key: 'session_id',
            id: secondSessionId,
            transcriptPath: secondTranscript
          },
          env: { CODEX_HOME: otherHome, ORCA_CODEX_HOME: '', ORCA_SMOKE_CASE: 'changed-home' },
          initiallyHidden: true
        }),
      {
        command,
        folder,
        worktreeId,
        oldPtyId: replacement.id,
        secondSessionId,
        secondTranscript,
        otherHome
      }
    )
    ownedPtyIds.push(rejected.id)
    expect(rejected.agentResumeUnavailable).toBe(true)
    await expect
      .poll(() => captureLines().find((line) => line.startsWith('changed-home ')) ?? '', {
        timeout: 30_000
      })
      .not.toBe('')
    const rejectedLine = captureLines().find((line) => line.startsWith('changed-home '))!
    expect(rejectedLine).not.toContain(`resume ${secondSessionId}`)
    expect(rejectedLine.split('|')[3].trim()).not.toMatch(/\bresume\b/)
    // Windows' selected runtime home overrides a spawn-only env path on fresh launches.
    expect(homeKey(rejectedLine.split('|')[2].trim())).toBe(homeKey(selectedFreshHome))
  } finally {
    for (const id of ownedPtyIds.toReversed()) {
      await page.evaluate((ownedId) => window.api.pty.kill(ownedId), id).catch(() => {})
    }
    rmSync(stubDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}
