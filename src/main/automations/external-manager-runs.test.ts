import { beforeEach, describe, expect, it, vi } from 'vitest'
import { listExternalAutomationRuns } from './external-manager-runs'
import { SSH_HOST_NOT_SERVED_MESSAGE } from '../providers/ssh-host-not-served-error'

const readRunsMock = vi.hoisted(() => vi.fn())
vi.mock('./hermes-cron-output', () => ({ readHermesCronOutputRunsPage: readRunsMock }))

describe('local external automation run history', () => {
  beforeEach(() => readRunsMock.mockReset())

  it('reads and maps local Hermes run pages', async () => {
    readRunsMock.mockResolvedValue({
      total: 1,
      runs: [
        {
          id: 'run-1',
          run_at: '2026-11-04T12:00:00.000Z',
          status: 'completed',
          output_preview: 'Finished'
        }
      ]
    })
    const result = await listExternalAutomationRuns({
      managerId: 'hermes:local',
      provider: 'hermes',
      target: { type: 'local' },
      jobId: 'job-1',
      page: 1,
      pageSize: 8
    })
    expect(result).toMatchObject({ managerId: 'hermes:local', total: 1, page: 1, pageSize: 8 })
    expect(result.runs[0]).toMatchObject({
      id: 'run-1',
      status: 'completed',
      outputPreview: 'Finished'
    })
    expect(readRunsMock).toHaveBeenCalledExactlyOnceWith('job-1', { page: 1, pageSize: 8 })
  })

  it('rejects SSH history before any relay or provider access', async () => {
    await expect(
      listExternalAutomationRuns({
        managerId: 'hermes:ssh:host-1',
        provider: 'hermes',
        target: { type: 'ssh', connectionId: 'host-1' },
        jobId: 'job-1',
        page: 1,
        pageSize: 8
      })
    ).rejects.toThrow(SSH_HOST_NOT_SERVED_MESSAGE)
    expect(readRunsMock).not.toHaveBeenCalled()
  })
})
