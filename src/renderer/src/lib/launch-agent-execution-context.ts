import { toast } from 'sonner'
import type { AgentStartupShell } from '../../../shared/tui-agent-startup-shell'
import { launchHostIsRemote } from '../../../shared/agent-launch-remote'
import { getConnectionIdFromState } from '@/lib/connection-context'
import { getRepoSshConnectionId, parseExecutionHostId } from '../../../shared/execution-host'
import type { ExecutionHostId } from '../../../shared/execution-host'
import { findRepoForHost } from '@/store/slices/repo-host-identity'
import {
  refineLocalLaunchPlatform,
  resolveExecutionHostAgentStartupShell,
  resolveWorktreeExecutionHostPlatform
} from '@/lib/execution-host-facts'
import type { useAppStore } from '@/store'

export type AgentLaunchExecutionContext = {
  /** `undefined` means rival host rows disagree, which is not evidence of a remote. */
  worktreeSshConnectionId: string | null | undefined
  resolvedLaunchPlatform: NodeJS.Platform
  isRemote: boolean
  /** Only set for a local Windows launch; remote targets need their own shell signal. */
  queuedShell: AgentStartupShell | undefined
}

/** `null` means the host's OS is unknown; the user has been told why the launch stopped. */
export function resolveAgentLaunchExecutionContext(
  store: ReturnType<typeof useAppStore.getState>,
  args: {
    worktreeId: string
    executionHostId?: ExecutionHostId
    launchPlatform?: NodeJS.Platform
  }
): AgentLaunchExecutionContext | null {
  const selectedHost = parseExecutionHostId(args.executionHostId)
  const worktree = args.executionHostId
    ? (store.getKnownWorktreeById?.(args.worktreeId, args.executionHostId) ?? null)
    : store.allWorktrees?.().find((entry: { id: string }) => entry.id === args.worktreeId)
  const repo = worktree
    ? args.executionHostId
      ? findRepoForHost(store.repos ?? [], worktree.repoId, { hostId: args.executionHostId })
      : store.repos?.find((entry) => entry.id === worktree.repoId)
    : null
  // Why: `store.repos.find` is host-blind and the same repo id can exist on local, SSH and runtime
  // hosts, so the row it returns can belong to a different host than the worktree names (#11163).
  // The shared resolver answers from the worktree's own host; `undefined` (rival rows disagree) is
  // not evidence of a remote, and main rejects that launch anyway.
  const worktreeSshConnectionId = selectedHost
    ? selectedHost.kind === 'ssh'
      ? selectedHost.targetId
      : repo
        ? getRepoSshConnectionId(repo)
        : null
    : getConnectionIdFromState(store, args.worktreeId)
  // Why getKnownWorktreeById: folder workspaces are not in allWorktrees, and their path marks WSL.
  const workspacePath = (
    store.getKnownWorktreeById?.(args.worktreeId, args.executionHostId) ??
    store.allWorktrees?.().find((entry) => entry.id === args.worktreeId)
  )?.path
  // Why: the agent runs on the workspace's execution host, so its OS and shell decide quoting (#22204).
  const fact = resolveWorktreeExecutionHostPlatform(
    store,
    args.worktreeId,
    workspacePath,
    undefined,
    args.executionHostId
  )
  if (fact.kind === 'withheld') {
    toast.error(fact.reason)
    return null
  }
  const launchHost = refineLocalLaunchPlatform(fact, args.launchPlatform)
  return {
    worktreeSshConnectionId,
    resolvedLaunchPlatform: launchHost.platform,
    isRemote: launchHostIsRemote(launchHost.hostKind, workspacePath),
    queuedShell: resolveExecutionHostAgentStartupShell(
      launchHost,
      store.settings?.terminalWindowsShell
    )
  }
}
