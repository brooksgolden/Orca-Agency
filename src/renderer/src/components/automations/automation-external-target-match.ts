import type { ExternalAutomationTarget } from '../../../../shared/automations-types'
import {
  getRepoExecutionHostId,
  parseExecutionHostId,
  toSshExecutionHostId
} from '../../../../shared/execution-host'
import type { Repo } from '../../../../shared/repo-types'

// connectionId can disagree with a repo's pinned executionHostId. The execution host owns the target.
export function repoMatchesExternalAutomationTarget(
  repo: Pick<Repo, 'connectionId' | 'executionHostId'>,
  target: ExternalAutomationTarget
): boolean {
  const repoHostId = getRepoExecutionHostId(repo)
  if (target.type === 'local') {
    return parseExecutionHostId(repoHostId)?.kind === 'local'
  }
  return repoHostId === toSshExecutionHostId(target.connectionId)
}
