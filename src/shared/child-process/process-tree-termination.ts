// Compatibility entry point for callers that still use the old shared path.
export {
  childProcessHasExited,
  forceTerminateProcessTree,
  signalProcessTree
} from '@orca/process-host/process-tree-termination'
