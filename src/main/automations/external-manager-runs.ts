import type {
  ExternalAutomationRunsInput,
  ExternalAutomationRunsPage
} from '../../shared/automations-types'
import { SshHostNotServedError } from '../providers/ssh-host-not-served-error'
import { mapHermesJobs } from './external-job-mappers'
import { assertExternalAutomationJobId } from './external-manager-job-id'
import { readHermesCronOutputRunsPage } from './hermes-cron-output'

/** Read local Hermes run history only. SSH history is intentionally not relayed. */
export async function listExternalAutomationRuns(
  input: ExternalAutomationRunsInput
): Promise<ExternalAutomationRunsPage> {
  assertExternalAutomationJobId(input.jobId)
  if (input.target.type !== 'local') {
    throw new SshHostNotServedError(input.target.connectionId)
  }
  const page = Number.isFinite(input.page) ? Math.max(1, Math.floor(input.page)) : 1
  const pageSize = Number.isFinite(input.pageSize)
    ? Math.min(100, Math.max(1, Math.floor(input.pageSize)))
    : 25
  const identity = {
    managerId: input.managerId,
    provider: input.provider,
    target: input.target,
    jobId: input.jobId,
    page,
    pageSize
  }
  if (input.provider !== 'hermes') {
    return { ...identity, total: 0, runs: [] }
  }
  const result = await readHermesCronOutputRunsPage(input.jobId, { page, pageSize })
  return {
    ...identity,
    total: Number.isFinite(result.total) ? result.total : 0,
    runs: mapHermesJobs(input.managerId, [{ id: input.jobId, runs: result.runs }])[0]?.runs ?? []
  }
}
