import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runExternalAutomationAction } from './external-manager'
import { createExternalAutomation, updateExternalAutomation } from './external-manager-mutations'
import { mapHermesJobs, mapOpenClawJobs } from './external-job-mappers'
import { SSH_HOST_NOT_SERVED_MESSAGE } from '../providers/ssh-host-not-served-error'
import type {
  ExternalAutomationAction,
  ExternalAutomationProvider
} from '../../shared/automations-types'
import type * as Fs from 'node:fs'

const runProcessMock = vi.hoisted(() => vi.fn())
const existsSyncMock = vi.hoisted(() => vi.fn(() => false))

vi.mock('@orca/process-host', () => ({ runProcess: runProcessMock }))
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof Fs>('fs')
  return {
    ...actual,
    existsSync: existsSyncMock
  }
})

beforeEach(() => {
  runProcessMock.mockReset()
  runProcessMock.mockResolvedValue({
    code: 0,
    signal: null,
    stdout: '',
    stderr: '',
    timedOut: false
  })
  existsSyncMock.mockReturnValue(false)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('mapHermesJobs', () => {
  it('normalizes Hermes cron jobs into external automation rows', () => {
    const jobs = mapHermesJobs('hermes:local', [
      {
        id: 'job-1',
        name: 'Nightly audit',
        prompt: 'Audit the repo for risky dependency changes',
        schedule_display: '0 9 * * 1-5',
        enabled: true,
        state: 'scheduled',
        next_run_at: '2026-05-16T09:00:00Z',
        last_run_at: '2026-05-15T09:00:00Z',
        last_status: 'ok',
        workdir: '/repo'
      }
    ])

    expect(jobs).toEqual([
      {
        id: 'job-1',
        managerId: 'hermes:local',
        provider: 'hermes',
        name: 'Nightly audit',
        schedule: '0 9 * * 1-5',
        rawSchedule: '0 9 * * 1-5',
        enabled: true,
        state: 'scheduled',
        prompt: 'Audit the repo for risky dependency changes',
        promptPreview: 'Audit the repo for risky dependency changes',
        nextRunAt: '2026-05-16T09:00:00Z',
        lastRunAt: '2026-05-15T09:00:00Z',
        lastStatus: 'ok',
        lastError: null,
        workdir: '/repo',
        runCount: 0,
        runs: []
      }
    ])
  })

  it('normalizes Hermes output files into run history', () => {
    const jobs = mapHermesJobs('hermes:local', [
      {
        id: 'job-1',
        name: 'Nightly audit',
        schedule_display: '0 9 * * 1-5',
        runs: [
          {
            id: 'job-1:2026-05-15_09-00-00.md',
            job_id: 'job-1',
            run_at: '2026-05-15T09:00:00',
            status: 'completed',
            output_preview: 'No risky dependency changes.',
            output_path: '/home/me/.hermes/cron/output/job-1/2026-05-15_09-00-00.md'
          },
          {
            id: 'job-1:2026-05-14_09-00-00.md',
            job_id: 'job-1',
            run_at: '2026-05-14T09:00:00',
            status: 'failed',
            error: 'RuntimeError: missing key'
          }
        ]
      }
    ])

    expect(jobs[0].runs).toEqual([
      {
        id: 'job-1:2026-05-15_09-00-00.md',
        managerId: 'hermes:local',
        provider: 'hermes',
        jobId: 'job-1',
        runAt: '2026-05-15T09:00:00',
        status: 'completed',
        outputPreview: 'No risky dependency changes.',
        outputContent: null,
        error: null,
        outputPath: '/home/me/.hermes/cron/output/job-1/2026-05-15_09-00-00.md'
      },
      {
        id: 'job-1:2026-05-14_09-00-00.md',
        managerId: 'hermes:local',
        provider: 'hermes',
        jobId: 'job-1',
        runAt: '2026-05-14T09:00:00',
        status: 'failed',
        outputPreview: null,
        outputContent: null,
        error: 'RuntimeError: missing key',
        outputPath: null
      }
    ])
  })

  it('falls back to script and schedule fields for older Hermes records', () => {
    const jobs = mapHermesJobs('hermes:local', [
      {
        id: 'job-2',
        script: 'disk-check.sh',
        no_agent: true,
        schedule: { display: 'every 30m' },
        enabled: false,
        state: 'paused',
        last_delivery_error: 'home channel missing'
      }
    ])

    expect(jobs[0]).toMatchObject({
      id: 'job-2',
      name: 'Script: disk-check.sh',
      schedule: 'every 30m',
      enabled: false,
      state: 'paused',
      promptPreview: 'Script: disk-check.sh',
      prompt: null,
      rawSchedule: 'every 30m',
      lastError: 'home channel missing'
    })
  })

  it('marks discovered Hermes services as continuous and read-only', () => {
    const jobs = mapHermesJobs('hermes:ssh:hostinger', [
      {
        id: 'service:tradepilot-hermes-bot',
        name: 'TradePilot Hermes bot',
        schedule_display: 'Always on',
        enabled: true,
        state: 'running',
        last_status: 'running',
        manageable: false,
        continuous: true
      }
    ])

    expect(jobs[0]).toMatchObject({
      id: 'service:tradepilot-hermes-bot',
      enabled: true,
      state: 'running',
      manageable: false,
      continuous: true
    })
  })
})

describe('createExternalAutomation', () => {
  it('creates local Hermes cron jobs through the CLI', async () => {
    await createExternalAutomation({
      managerId: 'hermes:local',
      provider: 'hermes',
      target: { type: 'local' },
      name: 'Nightly audit',
      prompt: 'Audit the repo',
      schedule: '0 9 * * 1-5',
      workdir: '/repo'
    })

    expect(runProcessMock).toHaveBeenCalledWith({
      program: 'hermes',
      args: [
        'cron',
        'create',
        '0 9 * * 1-5',
        'Audit the repo',
        '--name',
        'Nightly audit',
        '--deliver',
        'local',
        '--workdir',
        '/repo'
      ],
      timeoutMs: 30_000
    })
  })

  it('settles when local Hermes cron creation hangs', async () => {
    runProcessMock.mockResolvedValue({
      code: null,
      signal: null,
      stdout: '',
      stderr: '',
      timedOut: true
    })

    const promise = createExternalAutomation({
      managerId: 'hermes:local',
      provider: 'hermes',
      target: { type: 'local' },
      name: 'Nightly audit',
      prompt: 'Audit the repo',
      schedule: '0 9 * * 1-5',
      workdir: null
    })
    let settled = false
    void promise
      .catch(() => undefined)
      .finally(() => {
        settled = true
      })

    await expect(promise).rejects.toThrow('Local automation command timed out')
    expect(settled).toBe(true)
  })

  it('updates local Hermes cron jobs through the CLI', async () => {
    await updateExternalAutomation({
      managerId: 'hermes:local',
      provider: 'hermes',
      target: { type: 'local' },
      jobId: 'job-1',
      name: 'Nightly audit',
      prompt: 'Audit the repo',
      schedule: '0 10 * * 1-5',
      workdir: '/repo'
    })

    expect(runProcessMock).toHaveBeenCalledWith({
      program: 'hermes',
      args: [
        'cron',
        'edit',
        'job-1',
        '--schedule',
        '0 10 * * 1-5',
        '--prompt',
        'Audit the repo',
        '--name',
        'Nightly audit',
        '--workdir',
        '/repo'
      ],
      timeoutMs: 30_000
    })
  })
})

describe('runExternalAutomationAction', () => {
  it('rejects job IDs that could be parsed as CLI options', async () => {
    await expect(
      runExternalAutomationAction({
        managerId: 'openclaw:local',
        provider: 'openclaw',
        target: { type: 'local' },
        jobId: '-help',
        action: 'run'
      })
    ).rejects.toThrow('Invalid external automation job ID.')

    expect(runProcessMock).not.toHaveBeenCalled()
  })

  it('rejects an action name that is not in the provider table', async () => {
    await expect(
      runExternalAutomationAction({
        managerId: 'openclaw:local',
        provider: 'openclaw',
        target: { type: 'local' },
        jobId: 'job-1',
        action: 'purge' as ExternalAutomationAction
      })
    ).rejects.toThrow('Unsupported external automation action.')

    expect(runProcessMock).not.toHaveBeenCalled()
  })

  it('rejects an action inherited from the prototype chain', async () => {
    await expect(
      runExternalAutomationAction({
        managerId: 'openclaw:local',
        provider: 'openclaw',
        target: { type: 'local' },
        jobId: 'job-1',
        action: 'toString' as unknown as ExternalAutomationAction
      })
    ).rejects.toThrow('Unsupported external automation action.')

    expect(runProcessMock).not.toHaveBeenCalled()
  })

  it('rejects a provider that has no action table', async () => {
    await expect(
      runExternalAutomationAction({
        managerId: 'openclaw:local',
        provider: 'shellcat' as ExternalAutomationProvider,
        target: { type: 'local' },
        jobId: 'job-1',
        action: 'run'
      })
    ).rejects.toThrow('Unsupported external automation action.')

    expect(runProcessMock).not.toHaveBeenCalled()
  })

  it('refuses actions on an SSH host without launching locally', async () => {
    await expect(
      runExternalAutomationAction({
        managerId: 'openclaw:ssh:ssh-1',
        provider: 'openclaw',
        target: { type: 'ssh', connectionId: 'ssh-1' },
        jobId: 'job-1',
        action: 'run'
      })
    ).rejects.toThrow(SSH_HOST_NOT_SERVED_MESSAGE)
    expect(runProcessMock).not.toHaveBeenCalled()
  })
})

describe('mapOpenClawJobs', () => {
  it('normalizes OpenClaw cron jobs into external automation rows', () => {
    const jobs = mapOpenClawJobs('openclaw:local', {
      version: 1,
      jobs: [
        {
          id: 'claw-1',
          name: 'Morning report',
          enabled: true,
          schedule: { kind: 'cron', expr: '0 9 * * *', tz: 'America/Phoenix' },
          payload: { kind: 'agentTurn', message: 'Summarize overnight alerts' },
          state: {
            nextRunAtMs: Date.parse('2026-05-16T16:00:00Z'),
            lastRunAtMs: Date.parse('2026-05-15T16:00:00Z'),
            lastRunStatus: 'ok'
          }
        }
      ]
    })

    expect(jobs[0]).toMatchObject({
      id: 'claw-1',
      managerId: 'openclaw:local',
      provider: 'openclaw',
      name: 'Morning report',
      schedule: 'cron 0 9 * * * @ America/Phoenix',
      rawSchedule: '0 9 * * *',
      enabled: true,
      state: 'ok',
      prompt: 'Summarize overnight alerts',
      promptPreview: 'Summarize overnight alerts',
      nextRunAt: '2026-05-16T16:00:00.000Z',
      lastRunAt: '2026-05-15T16:00:00.000Z',
      lastStatus: 'ok'
    })
  })
})
