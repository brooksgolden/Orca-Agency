import { describe, expect, it } from 'vitest'
import type { TerminalLayoutSnapshot } from '../../../../shared/terminal-tab-types'
import {
  getLatestWorkspaceAgentTitle,
  type WorkspaceAgentTitleRow
} from './worktree-card-task-title'

const LEAF_A = '11111111-1111-4111-8111-111111111111'
const LEAF_B = '22222222-2222-4222-8222-222222222222'

function agent(
  title: string,
  updatedAt: number,
  rowSource: WorkspaceAgentTitleRow['rowSource'] = 'live'
): WorkspaceAgentTitleRow {
  return {
    rowSource,
    agentType: 'codex',
    paneKey: `tab-${title.length}:${LEAF_A}`,
    tab: { id: `tab-${title.length}`, title, customTitle: title },
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
    const orchestratedChild = {
      ...agent('Review code', 300),
      lineage: { depth: 1, isFirstSibling: true, isLastSibling: true, childCount: 0 } as const
    }
    expect(
      getLatestWorkspaceAgentTitle([agent('Orca sidebar', 100), orchestratedChild], true)
    ).toBe('Orca sidebar')
  })

  it('names the newest agent from its own pane in a split terminal tab', () => {
    const split: TerminalLayoutSnapshot = {
      root: {
        type: 'split',
        direction: 'horizontal',
        first: { type: 'leaf', leafId: LEAF_A },
        second: { type: 'leaf', leafId: LEAF_B }
      },
      activeLeafId: LEAF_A,
      expandedLeafId: null
    }
    const pane = (leafId: string, updatedAt: number): WorkspaceAgentTitleRow => ({
      rowSource: 'live',
      agentType: 'claude',
      paneKey: `tab-1:${leafId}`,
      // The tab title follows the focused pane (A); pane B's agent must not inherit it.
      tab: { id: 'tab-1', title: 'Linear work log', customTitle: null },
      entry: { prompt: 'prompt', updatedAt, stateStartedAt: updatedAt },
      startedAt: updatedAt
    })
    expect(
      getLatestWorkspaceAgentTitle(
        [pane(LEAF_A, 100), pane(LEAF_B, 200)],
        true,
        { 'tab-1': split },
        { 'tab-1': { 1: 'Linear work log', 2: 'Redis cache strategy' } }
      )
    ).toBe('Redis cache strategy')
  })
})
