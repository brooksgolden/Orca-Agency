import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { HERMES_SERVICES_FILE } from '../relay/external-automation-storage-paths'
import type { ExternalAutomationCommandRunner } from '../relay/external-automation-command-executor'
import { readWindowsScheduledTaskJobs } from './windows-scheduled-task-catalog'

type ServiceDefinition = {
  id: string
  name: string
  units: string[]
  workdir: string | null
}

type UnitState = {
  id: string
  loadState: string
  activeState: string
  subState: string
  activeEnterTimestamp: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readDefinitions(value: unknown): ServiceDefinition[] {
  const records = isRecord(value) && Array.isArray(value.services) ? value.services : []
  return records.map((entry) => {
    if (!isRecord(entry)) {
      throw new Error('Hermes service entries must be objects.')
    }
    const id = typeof entry.id === 'string' ? entry.id.trim() : ''
    const name = typeof entry.name === 'string' ? entry.name.trim() : ''
    const units = Array.isArray(entry.units)
      ? entry.units.filter((unit): unit is string => typeof unit === 'string' && unit.trim() !== '')
      : []
    if (!id || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) || !name || units.length === 0) {
      throw new Error('Hermes services require a safe id, name, and at least one systemd unit.')
    }
    if (units.some((unit) => !/^[A-Za-z0-9@_.:-]+\.service$/.test(unit))) {
      throw new Error(`Hermes service ${id} contains an invalid systemd unit name.`)
    }
    return {
      id,
      name,
      units,
      workdir:
        typeof entry.workdir === 'string' && entry.workdir.trim() ? entry.workdir.trim() : null
    }
  })
}

function commandStdout(result: unknown): string {
  if (!isRecord(result)) {
    return ''
  }
  return typeof result.stdout === 'string' ? result.stdout : ''
}

function parseUnitState(stdout: string, fallbackId: string): UnitState {
  const fields = new Map(
    stdout
      .split(/\r?\n/)
      .map((line) => line.split(/=(.*)/s))
      .filter((parts) => parts.length >= 2)
      .map(([key, value]) => [key, value] as const)
  )
  return {
    id: fields.get('Id') || fallbackId,
    loadState: fields.get('LoadState') || 'unknown',
    activeState: fields.get('ActiveState') || 'unknown',
    subState: fields.get('SubState') || 'unknown',
    activeEnterTimestamp: fields.get('ActiveEnterTimestamp') || null
  }
}

function latestStart(states: UnitState[]): string | null {
  const starts = states
    .map((state) => state.activeEnterTimestamp)
    .filter((value): value is string => Boolean(value))
    .map((value) => ({ value, time: Date.parse(value) }))
    .filter(({ time }) => Number.isFinite(time))
    .sort((left, right) => right.time - left.time)
  return starts[0]?.value ?? null
}

async function readUnitState(
  unit: string,
  runCommand: ExternalAutomationCommandRunner
): Promise<UnitState> {
  const result = await runCommand(
    'systemctl',
    [
      'show',
      unit,
      '--no-pager',
      '--property=Id',
      '--property=LoadState',
      '--property=ActiveState',
      '--property=SubState',
      '--property=ActiveEnterTimestamp'
    ],
    { encoding: 'utf-8', timeout: 5000 }
  )
  return parseUnitState(commandStdout(result), unit)
}

function serviceJob(definition: ServiceDefinition, states: UnitState[]): Record<string, unknown> {
  const running = states.every(
    (state) => state.loadState === 'loaded' && state.activeState === 'active'
  )
  const failed = states.filter(
    (state) => state.loadState !== 'loaded' || state.activeState === 'failed'
  )
  const stopped = states.filter((state) => state.activeState !== 'active')
  const detail = states
    .map((state) => `${state.id}: ${state.activeState}/${state.subState}`)
    .join(', ')
  return {
    id: `service:${definition.id}`,
    name: definition.name,
    schedule: { kind: 'continuous', display: 'Always on' },
    schedule_display: 'Always on',
    enabled: running,
    state: running ? 'running' : failed.length > 0 ? 'failed' : 'stopped',
    prompt: null,
    script: null,
    next_run_at: null,
    last_run_at: latestStart(states),
    last_status: running ? 'running' : stopped.length > 0 ? 'stopped' : 'unknown',
    last_error: failed.length > 0 ? detail : null,
    workdir: definition.workdir,
    run_count: 0,
    runs: [],
    manageable: false,
    continuous: true,
    service_units: definition.units,
    service_state: detail
  }
}

export async function readHermesServiceJobs(
  runCommand: ExternalAutomationCommandRunner
): Promise<Record<string, unknown>[]> {
  if (!existsSync(HERMES_SERVICES_FILE)) {
    return []
  }
  const value: unknown = JSON.parse(await readFile(HERMES_SERVICES_FILE, 'utf-8'))
  const definitions = readDefinitions(value)
  const [services, tasks] = await Promise.all([
    Promise.all(
      definitions.map(async (definition) => {
        try {
          const states = await Promise.all(
            definition.units.map((unit) => readUnitState(unit, runCommand))
          )
          return serviceJob(definition, states)
        } catch (error) {
          return {
            ...serviceJob(
              definition,
              definition.units.map((unit) => ({
                id: unit,
                loadState: 'unknown',
                activeState: 'unknown',
                subState: 'unknown',
                activeEnterTimestamp: null
              }))
            ),
            last_error: error instanceof Error ? error.message : String(error)
          }
        }
      })
    ),
    readWindowsScheduledTaskJobs(value, runCommand)
  ])
  return [...services, ...tasks]
}
