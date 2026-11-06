import type { ExternalAutomationCommandRunner } from '../relay/external-automation-command-executor'

type ScheduledTaskDefinition = {
  id: string
  name: string
  taskName: string
  schedule: string
  workdir: string | null
}

type ScheduledTaskState = {
  state: string
  lastRunAt: string | null
  nextRunAt: string | null
  lastResult: number | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function commandStdout(result: unknown): string {
  if (!isRecord(result)) {
    return ''
  }
  return typeof result.stdout === 'string' ? result.stdout : ''
}

function readDefinitions(value: unknown): ScheduledTaskDefinition[] {
  const records =
    isRecord(value) && Array.isArray(value.scheduled_tasks) ? value.scheduled_tasks : []
  return records.map((entry) => {
    if (!isRecord(entry)) {
      throw new Error('Windows scheduled task entries must be objects.')
    }
    const id = typeof entry.id === 'string' ? entry.id.trim() : ''
    const name = typeof entry.name === 'string' ? entry.name.trim() : ''
    const taskName = typeof entry.task_name === 'string' ? entry.task_name.trim() : ''
    const schedule = typeof entry.schedule === 'string' ? entry.schedule.trim() : ''
    if (
      !id ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) ||
      !name ||
      !taskName ||
      taskName.length > 200 ||
      /['\r\n]/.test(taskName) ||
      !schedule
    ) {
      throw new Error('Windows scheduled tasks require a safe id, name, task_name, and schedule.')
    }
    return {
      id,
      name,
      taskName,
      schedule,
      workdir:
        typeof entry.workdir === 'string' && entry.workdir.trim() ? entry.workdir.trim() : null
    }
  })
}

function parseCsvRow(value: string): string[] {
  const fields: string[] = []
  let field = ''
  let quoted = false
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if (character === '"') {
      if (quoted && value[index + 1] === '"') {
        field += '"'
        index += 1
      } else {
        quoted = !quoted
      }
    } else if (character === ',' && !quoted) {
      fields.push(field)
      field = ''
    } else {
      field += character
    }
  }
  fields.push(field)
  return fields
}

function taskDate(value: string | undefined): string | null {
  if (!value || value === 'N/A') {
    return null
  }
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null
}

function readTaskState(stdout: string): ScheduledTaskState {
  const row = stdout.replaceAll('\0', '').split(/\r?\n/).find(Boolean)
  const fields = row ? parseCsvRow(row) : []
  if (fields.length < 7) {
    throw new Error('Windows scheduled task query returned an incomplete row.')
  }
  const lastResult = Number(fields[6])
  return {
    state: fields[3] || 'Unknown',
    lastRunAt: taskDate(fields[5]),
    nextRunAt: taskDate(fields[2]),
    lastResult: Number.isFinite(lastResult) ? lastResult : null
  }
}

async function queryTask(
  definition: ScheduledTaskDefinition,
  runCommand: ExternalAutomationCommandRunner
): Promise<ScheduledTaskState> {
  const result = await runCommand(
    'schtasks.exe',
    ['/Query', '/TN', definition.taskName, '/FO', 'CSV', '/V', '/NH'],
    { encoding: 'utf-8', timeout: 5000 }
  )
  return readTaskState(commandStdout(result))
}

function taskJob(
  definition: ScheduledTaskDefinition,
  task: ScheduledTaskState
): Record<string, unknown> {
  const normalized = task.state.toLowerCase()
  const running = normalized === 'running'
  const disabled = normalized === 'disabled'
  const neverRun = task.lastResult === 267011
  const succeeded = task.lastResult === 0
  const informational =
    task.lastResult !== null &&
    [267008, 267009, 267010, 267011, 267012, 267013].includes(task.lastResult)
  const failed = task.lastResult !== null && !succeeded && !informational
  return {
    id: `task:${definition.id}`,
    name: definition.name,
    schedule: { kind: 'external', display: definition.schedule },
    schedule_display: definition.schedule,
    enabled: !disabled,
    state: running ? 'running' : disabled ? 'paused' : failed ? 'failed' : 'scheduled',
    prompt: null,
    script: null,
    next_run_at: disabled ? null : task.nextRunAt,
    last_run_at: neverRun ? null : task.lastRunAt,
    last_status: running ? 'running' : failed ? 'failed' : succeeded ? 'completed' : null,
    last_error:
      failed && task.lastResult !== null
        ? `Windows Task Scheduler result 0x${task.lastResult.toString(16).toUpperCase()}`
        : null,
    workdir: definition.workdir,
    run_count: 0,
    runs: [],
    manageable: false,
    continuous: false,
    scheduled_task: definition.taskName,
    service_state: task.state
  }
}

export async function readWindowsScheduledTaskJobs(
  value: unknown,
  runCommand: ExternalAutomationCommandRunner
): Promise<Record<string, unknown>[]> {
  return Promise.all(
    readDefinitions(value).map(async (definition) => {
      try {
        return taskJob(definition, await queryTask(definition, runCommand))
      } catch (error) {
        return {
          ...taskJob(definition, {
            state: 'Unknown',
            lastRunAt: null,
            nextRunAt: null,
            lastResult: null
          }),
          state: 'unknown',
          last_error: error instanceof Error ? error.message : String(error)
        }
      }
    })
  )
}
