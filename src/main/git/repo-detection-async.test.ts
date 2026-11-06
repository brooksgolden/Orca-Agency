import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import * as runner from './runner'
import * as markerScan from './repo-git-marker-scan'
import * as asyncDetection from './repo-detection-async'
import { runProcess } from '@orca/process-host'
import {
  getGitRepoRoot,
  getGitRepoRootAsync,
  inspectGitRepoForRegistration,
  inspectGitRepoForRegistrationAsync,
  isGitRepo,
  isGitRepoAsync
} from './repo-detection'

// The mocked-Git cases below spy on the Git runner and marker scan, so the real-Git suite stays unmocked.
describe('asynchronous repository detection with mocked Git', () => {
  let root: string
  let exec: MockInstance<typeof runner.gitExecFileAsync>
  let scan: MockInstance<typeof markerScan.scanGitMarkerSync>

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'orca-async-repo-'))
    exec = vi.spyOn(runner, 'gitExecFileAsync')
    scan = vi.spyOn(markerScan, 'scanGitMarkerSync').mockReturnValue({ status: 'absent' })
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(root, { recursive: true, force: true })
  })

  it('lets main-loop work proceed while the Git process is still pending', async () => {
    let finish: (value: { stdout: string; stderr: string }) => void = () => {}
    exec.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const result = asyncDetection.isGitRepoAsync(root)
    await vi.waitFor(() => expect(exec).toHaveBeenCalledOnce())
    const tick = await new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 0))
    expect(tick).toBe(true)
    finish({ stdout: 'true\n', stderr: '' })
    await expect(result).resolves.toBe(true)
  })

  it('preserves bare-repo detection and clean negative Git answers', async () => {
    exec
      .mockResolvedValueOnce({ stdout: 'false\n', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'true\n', stderr: '' })
    await expect(asyncDetection.isGitRepoAsync(root)).resolves.toBe(true)
    exec.mockResolvedValue({ stdout: 'false\n', stderr: '' })
    scan.mockReturnValue({ status: 'valid', rootPath: root })
    await expect(asyncDetection.isGitRepoAsync(root)).resolves.toBe(false)
    expect(scan).not.toHaveBeenCalled()
  })

  it('keeps metadata recovery when Git fails and does not probe missing directories', async () => {
    exec.mockRejectedValue(new Error('Git unavailable'))
    scan.mockReturnValue({ status: 'valid', rootPath: root })
    await expect(asyncDetection.isGitRepoAsync(root)).resolves.toBe(true)
    await expect(asyncDetection.getGitRepoRootAsync(root)).resolves.toBe(root.replaceAll('\\', '/'))
    exec.mockClear()
    await expect(asyncDetection.isGitRepoAsync(join(root, 'missing'))).resolves.toBe(false)
    await expect(asyncDetection.getGitRepoRootAsync(join(root, 'missing'))).resolves.toBe(
      join(root, 'missing')
    )
    expect(exec).not.toHaveBeenCalled()
  })

  it('resolves a nested directory from one asynchronous Git command', async () => {
    const nested = join(root, 'nested')
    await mkdir(nested)
    exec.mockResolvedValue({ stdout: `true\n${root}\n`, stderr: '' })
    await expect(asyncDetection.getGitRepoRootAsync(nested)).resolves.toBe(
      root.replaceAll('\\', '/')
    )
    expect(exec).toHaveBeenCalledOnce()
    expect(scan).not.toHaveBeenCalled()
  })
})

let fixture: string
async function git(cwd: string, args: string[]): Promise<void> {
  const result = await runProcess({ program: 'git', args, cwd, timeoutMs: 15_000 })
  if (result.code !== 0) {
    throw new Error(result.stderr)
  }
}

beforeEach(() => {
  fixture = mkdtempSync(join(tmpdir(), 'orca-repo-async-'))
})
afterEach(() => {
  vi.restoreAllMocks()
  rmSync(fixture, { recursive: true, force: true })
})

async function expectSameDetection(path: string): Promise<void> {
  expect(await isGitRepoAsync(path)).toBe(isGitRepo(path))
  expect(await getGitRepoRootAsync(path)).toBe(getGitRepoRoot(path))
  expect(await inspectGitRepoForRegistrationAsync(path)).toEqual(
    inspectGitRepoForRegistration(path)
  )
}

describe('asynchronous repository detection with real Git', () => {
  it('preserves normal, nested, linked-worktree, bare, and folder results', async () => {
    const repo = join(fixture, 'repo with spaces')
    const nested = join(repo, 'packages', 'web')
    mkdirSync(nested, { recursive: true })
    await git(repo, ['init', '--quiet'])
    await git(repo, [
      '-c',
      'user.name=Orca Test',
      '-c',
      'user.email=orca@example.invalid',
      'commit',
      '--allow-empty',
      '--quiet',
      '-m',
      'fixture'
    ])
    const linked = join(fixture, 'linked worktree')
    await git(repo, ['worktree', 'add', '--quiet', '-b', 'fixture-linked', linked])
    const bare = join(fixture, 'bare.git')
    await git(fixture, ['init', '--bare', '--quiet', bare])
    const folder = join(fixture, 'folder')
    mkdirSync(folder)
    for (const path of [repo, nested, linked, bare, folder]) {
      await expectSameDetection(path)
    }
    expect(await isGitRepoAsync(folder)).toBe(false)
    expect(await isGitRepoAsync(bare)).toBe(true)
    expect((await inspectGitRepoForRegistrationAsync(linked)).mainRepoPath).not.toBeNull()
  })

  it('preserves genuine metadata fallback when asynchronous Git cannot answer', async () => {
    const repo = join(fixture, 'fallback repo')
    const nested = join(repo, 'packages')
    mkdirSync(nested, { recursive: true })
    await git(repo, ['init', '--quiet'])
    vi.spyOn(runner, 'gitExecFileAsync').mockRejectedValue(new Error('Git unavailable'))
    expect(await isGitRepoAsync(nested)).toBe(true)
    expect(await getGitRepoRootAsync(nested)).toBe(repo.replaceAll('\\', '/'))
    expect(await isGitRepoAsync(join(repo, '.git'))).toBe(false)
  })

  it.skipIf(process.platform === 'win32')(
    'preserves newlines, dollar signs and trailing spaces in roots and linked identity',
    async () => {
      const repo = join(fixture, 'repo\nwith dollar$ and trailing space ')
      const nested = join(repo, 'nested\n')
      mkdirSync(nested, { recursive: true })
      await git(repo, ['init', '--quiet'])
      await git(repo, [
        '-c',
        'user.name=Orca Test',
        '-c',
        'user.email=orca@example.invalid',
        'commit',
        '--allow-empty',
        '--quiet',
        '-m',
        'fixture'
      ])
      const linked = join(fixture, 'linked\n ')
      await git(repo, ['worktree', 'add', '--quiet', '-b', 'edge-linked', linked])
      for (const path of [repo, nested, linked]) {
        await expectSameDetection(path)
      }
      expect((await inspectGitRepoForRegistrationAsync(nested)).rootPath).toBe(realpathSync(repo))
      expect((await inspectGitRepoForRegistrationAsync(linked)).mainRepoPath).toBe(
        realpathSync(repo)
      )
    }
  )

  it('preserves symlink target identity and rejects its invalid nested marker without Git', async () => {
    const repo = join(fixture, 'target')
    const nested = join(repo, 'nested')
    mkdirSync(nested, { recursive: true })
    await git(repo, ['init', '--quiet'])
    const alias = join(fixture, 'alias')
    symlinkSync(nested, alias, process.platform === 'win32' ? 'junction' : 'dir')
    await expectSameDetection(alias)
    vi.spyOn(runner, 'gitExecFileSync').mockImplementation(() => {
      throw new Error('Git unavailable')
    })
    vi.spyOn(runner, 'gitExecFileAsync').mockRejectedValue(new Error('Git unavailable'))
    await expectSameDetection(alias)
    expect((await inspectGitRepoForRegistrationAsync(alias)).rootPath).toBe(
      realpathSync(repo).replaceAll('\\', '/')
    )
    writeFileSync(join(nested, '.git'), 'gitdir: missing-metadata')
    await expectSameDetection(alias)
    expect(await isGitRepoAsync(alias)).toBe(false)
  })
})
