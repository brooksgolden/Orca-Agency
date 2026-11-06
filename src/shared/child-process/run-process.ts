// Compatibility entry point for the remaining async shared caller. Keep the
// synchronous process-host API out of renderer/main compatibility imports.
export { runProcess } from '@orca/process-host'

// Preserve the former helper exports for callers using this legacy path.
export { resolveSpawn, type ResolvedSpawn } from './spawn-resolution'
