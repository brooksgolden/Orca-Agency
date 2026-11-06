import os from 'node:os'

const maxOldSpaceSizeMb = 4096
const minOldSpaceSizeMb = 2048
const reservedSystemMemoryMb = 1024

export function getBuildOldSpaceSizeMb(totalMemoryBytes = os.totalmem()) {
  const totalMemoryMb = Math.floor(totalMemoryBytes / 1024 / 1024)
  const hostSizedLimitMb = Math.max(minOldSpaceSizeMb, totalMemoryMb - reservedSystemMemoryMb)

  return Math.min(maxOldSpaceSizeMb, hostSizedLimitMb)
}

export function appendBuildOldSpaceOption(existingNodeOptions, totalMemoryBytes = os.totalmem()) {
  const trimmedNodeOptions = existingNodeOptions?.trim()
  // A caller may choose a smaller heap to protect an active desktop.
  const explicitLimits = [
    ...(trimmedNodeOptions ?? '').matchAll(/(?:^|\s)--max[-_]old[-_]space[-_]size=(\d+)(?=\s|$)/g)
  ]
    .map((match) => Number(match[1]))
    .filter((limit) => Number.isSafeInteger(limit) && limit > 0)
  const limit = Math.min(getBuildOldSpaceSizeMb(totalMemoryBytes), ...explicitLimits)
  const requestedNodeOptions = `--max-old-space-size=${limit}`

  return trimmedNodeOptions ? `${trimmedNodeOptions} ${requestedNodeOptions}` : requestedNodeOptions
}
