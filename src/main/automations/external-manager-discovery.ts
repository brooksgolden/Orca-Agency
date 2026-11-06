import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type {
  ExternalAutomationManager,
  ExternalAutomationProvider
} from '../../shared/automations-types'
import { runProcess } from '../../shared/child-process/run-process'
import { readHermesServiceJobs } from '../../relay/hermes-service-catalog'
import { mapHermesJobs, mapOpenClawJobs } from './external-job-mappers'
import { readHermesCronOutputRunsPage } from './hermes-cron-output'
import { isExternalAutomationCommandOnPath } from './external-manager-local-command'

const HERMES_HOME = process.env.HERMES_HOME?.trim() || join(homedir(), '.hermes')
const HERMES_JOBS_FILE = join(HERMES_HOME, 'cron', 'jobs.json')
const OPENCLAW_JOBS_FILE = join(homedir(), '.openclaw', 'cron', 'jobs.json')
const PROVIDER_LABELS: Record<ExternalAutomationProvider, string> = {
  hermes: 'Hermes',
  openclaw: 'OpenClaw'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readLocalHermesJobs(): Promise<unknown[]> {
  const cronJobs = existsSync(HERMES_JOBS_FILE)
    ? await readFile(HERMES_JOBS_FILE, 'utf-8').then((content) => {
        const parsed = JSON.parse(content) as unknown
        return Array.isArray(parsed)
          ? parsed
          : isRecord(parsed) && Array.isArray(parsed.jobs)
            ? parsed.jobs
            : []
      })
    : []
  const [jobs, services] = await Promise.all([
    Promise.all(
      cronJobs.map(async (job) => {
        if (!isRecord(job)) {
          return job
        }
        const jobId = typeof job.id === 'string' ? job.id : null
        if (!jobId) {
          return job
        }
        const runsPage = await readHermesCronOutputRunsPage(jobId, { page: 1, pageSize: 0 })
        return {
          ...job,
          run_count: runsPage.total,
          runs: []
        }
      })
    ),
    readHermesServiceJobs(async (command, args, options) => {
      const result = await runProcess({ program: command, args, timeoutMs: options.timeout })
      if (result.timedOut) {
        throw new Error(`${command} timed out after ${options.timeout}ms.`)
      }
      if (result.code !== 0) {
        throw new Error(result.stderr.trim() || `${command} exited with code ${result.code}.`)
      }
      return result
    })
  ])
  return [...jobs, ...services]
}

async function readLocalOpenClawJobs(): Promise<unknown[]> {
  if (!existsSync(OPENCLAW_JOBS_FILE)) {
    return []
  }
  const content = await readFile(OPENCLAW_JOBS_FILE, 'utf-8')
  const parsed = JSON.parse(content) as unknown
  return isRecord(parsed) && Array.isArray(parsed.jobs) ? parsed.jobs : []
}

export async function listLocalManager(
  provider: ExternalAutomationProvider
): Promise<ExternalAutomationManager | null> {
  const [availableResult, jobsResult] = await Promise.allSettled([
    isExternalAutomationCommandOnPath(provider),
    provider === 'hermes' ? readLocalHermesJobs() : readLocalOpenClawJobs()
  ])
  const available = availableResult.status === 'fulfilled' && availableResult.value
  const jobs = jobsResult.status === 'fulfilled' ? jobsResult.value : []
  const readError = jobsResult.status === 'rejected' ? String(jobsResult.reason) : null
  if (!available && jobs.length === 0 && !readError) {
    return null
  }
  const managerId = `${provider}:local`
  const providerLabel = PROVIDER_LABELS[provider]
  return {
    id: managerId,
    provider,
    label: `${providerLabel} on this computer`,
    targetLabel: 'this computer',
    target: { type: 'local' },
    status: readError ? 'unavailable' : 'available',
    error:
      readError ??
      (available
        ? null
        : `${providerLabel} jobs were found, but the ${provider} CLI is not on PATH.`),
    canManage: !readError && available,
    jobs: provider === 'hermes' ? mapHermesJobs(managerId, jobs) : mapOpenClawJobs(managerId, jobs)
  }
}
