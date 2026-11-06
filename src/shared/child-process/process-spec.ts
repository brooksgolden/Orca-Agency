// Compatibility entry point for older shared callers. The implementation and
// public process contract live in @orca/process-host.
export type {
  ChildProcessHandle,
  ProcessResult,
  ProcessSpec,
  ProcessTerminationBarrier,
  SpawnedProcess
} from '@orca/process-host/process-spec'

export {
  DEFAULT_MAX_OUTPUT_BYTES,
  DEFAULT_PROCESS_TIMEOUT_MS
} from '@orca/process-host/process-spec'
