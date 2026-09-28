import { describe, expect, it } from 'vitest'
import {
  getLatestWorkspaceAgentTitle,
  type WorkspaceAgentTitleRow
} from './worktree-card-task-title'

function agent(
  title: string,
  updatedAt: number,
  rowSource: WorkspaceAgentTitleRow['rowSource'] = 'live'
): WorkspaceAgentTitleRow {
  return {
    rowSource,
    agentType: 'codex',
    tab: { title, customTitle: title },
    entry: { prompt: title, updatedAt, stateStartedAt: updatedAt },
    startedAt: updatedAt
  }
}

describe('latest workspace agent title', () => {
  it('shows the most recently worked conversation instead of the workspace container', () => {
    expect(
      getLatestWorkspaceAgentTitle(
        [agent("Jake's website", 100), agent('Gaby Martinez website', 200)],
        true
      )
    ).toBe('Gaby Martinez website')
  })

  it('does not let a child agent replace the parent conversation title', () => {
    expect(
      getLatestWorkspaceAgentTitle(
        [agent('Orca sidebar', 100), agent('Review code', 200, 'subagent')],
        true
      )
    ).toBe('Orca sidebar')
  })
})
