import type { indexPersistedPtySurfaceBindings } from './runtime-worktree-binding-index'
import { runtimeWorktreeIdsEqual } from './runtime-worktree-path-identity'

export function resolveControllerWorkspaceOwner(
  providerId: string | undefined,
  resolvedProviderId: string | undefined,
  persistedId: string | undefined,
  inferredId: string | null
): string | undefined {
  if (resolvedProviderId) {
    return resolvedProviderId
  }
  if (providerId && persistedId && inferredId && runtimeWorktreeIdsEqual(providerId, inferredId)) {
    return persistedId
  }
  return providerId ?? persistedId ?? inferredId ?? undefined
}

/** A local layout move must name the same observed PTY incarnation and its former owner. */
export function hasPersistedTerminalMoveEvidence(
  surface: ReturnType<typeof indexPersistedPtySurfaceBindings> extends ReadonlyMap<string, infer T>
    ? T | undefined
    : never,
  incarnationId: string | undefined,
  providerWorktreeId: string | undefined,
  connectionId: string | null
): boolean {
  return Boolean(
    connectionId === null &&
    incarnationId &&
    surface?.incarnationId === incarnationId &&
    surface.relocatedFromWorktreeIds?.some((id) =>
      runtimeWorktreeIdsEqual(id, providerWorktreeId ?? '')
    )
  )
}
