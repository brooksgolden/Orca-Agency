export const TERMINAL_PATH_EXISTS_CACHE_MAX_ENTRIES = 1024
const CONTEXT_PROOF_MAX_AGE_MS = 5000
const checkedAtByCache = new WeakMap<object, Map<string, number>>()

export function wasTerminalPathExistsCacheRecentlyProbed(
  cache: Map<string, boolean> | undefined,
  key: string
): boolean {
  const checkedAt = cache && checkedAtByCache.get(cache)?.get(key)
  return Boolean(
    cache &&
    checkedAt !== undefined &&
    cache.has(key) &&
    Date.now() - checkedAt <= CONTEXT_PROOF_MAX_AGE_MS
  )
}

const NEGATIVE_PATH_EXISTS_TTL_MS = 10_000

export type TerminalPathExistsProbe = { checkedAt: number; sequence: number }
type TerminalPathExistsCacheEntry = TerminalPathExistsProbe & { exists: boolean }
export type TerminalPathExistsCache = Map<string, TerminalPathExistsCacheEntry>

let lastTerminalPathExistsProbeSequence = 0

export function startTerminalPathExistsProbe(
  checkedAt: number = Date.now()
): TerminalPathExistsProbe {
  lastTerminalPathExistsProbeSequence += 1
  return { checkedAt, sequence: lastTerminalPathExistsProbeSequence }
}

export function readTerminalPathExistence(
  cache: TerminalPathExistsCache,
  key: string,
  now: number = Date.now()
): boolean | undefined {
  const entry = cache.get(key)
  if (entry === undefined) {
    return undefined
  }
  // Keep expired entries to reject older probes that complete after a newer result.
  if (!entry.exists && now - entry.checkedAt >= NEGATIVE_PATH_EXISTS_TTL_MS) {
    return undefined
  }
  return readTerminalPathExistsCache(cache, key)?.exists
}

export function writeTerminalPathExistence(
  cache: TerminalPathExistsCache,
  key: string,
  exists: boolean,
  probe: TerminalPathExistsProbe = startTerminalPathExistsProbe()
): void {
  const existing = cache.get(key)
  if (existing && existing.sequence > probe.sequence) {
    return
  }
  writeTerminalPathExistsCache(cache, key, { exists, ...probe })
}

// Scope POSIX SSH paths by connection; local/runtime cache keys retain legacy scope.
export function getTerminalPathExistsCacheKey({
  absolutePath,
  connectionId,
  isRemoteRuntimePath,
  runtimeEnvironmentId
}: {
  absolutePath: string
  connectionId?: string | null
  isRemoteRuntimePath?: boolean
  runtimeEnvironmentId?: string | null
}): string {
  const runtimeId = runtimeEnvironmentId?.trim()
  if (isRemoteRuntimePath && runtimeId) {
    return `${runtimeId}\0${absolutePath}`
  }
  const sshConnectionId = connectionId?.trim()
  if (sshConnectionId) {
    return `ssh:${sshConnectionId}\0${absolutePath}`
  }
  return `${runtimeId || 'active'}\0${absolutePath}`
}

export function readTerminalPathExistsCache<T>(cache: Map<string, T>, key: string): T | undefined {
  const value = cache.get(key)
  if (value !== undefined) {
    cache.delete(key)
    cache.set(key, value)
  }
  return value
}

export function writeTerminalPathExistsCache<T>(
  cache: Map<string, T>,
  key: string,
  value: T
): void {
  if (cache.size === 0) {
    checkedAtByCache.get(cache)?.clear()
  }
  if (cache.has(key)) {
    cache.delete(key)
  } else {
    // Bound recent probes because terminal output can name unlimited unique paths.
    while (cache.size >= TERMINAL_PATH_EXISTS_CACHE_MAX_ENTRIES) {
      const oldestKey = cache.keys().next().value
      if (oldestKey === undefined) {
        break
      }
      cache.delete(oldestKey)
      checkedAtByCache.get(cache)?.delete(oldestKey)
    }
  }
  cache.set(key, value)
  let checkedAt = checkedAtByCache.get(cache)
  if (!checkedAt) {
    checkedAt = new Map()
    checkedAtByCache.set(cache, checkedAt)
  }
  checkedAt.set(key, Date.now())
  while (checkedAt.size > TERMINAL_PATH_EXISTS_CACHE_MAX_ENTRIES) {
    const oldestKey = checkedAt.keys().next().value
    if (oldestKey === undefined) {
      break
    }
    checkedAt.delete(oldestKey)
  }
}
