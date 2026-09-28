import { describe, expect, it } from 'vitest'
import { cloneDefaultWorkspaceStatuses } from '../../../../shared/workspace-statuses'
import { canMarkWorkspaceDone } from './worktree-card-mark-done'

describe('canMarkWorkspaceDone', () => {
  const statuses = cloneDefaultWorkspaceStatuses()

  it.each(['todo', 'in-progress', 'in-review', undefined])(
    'offers Done for an active %s workspace',
    (workspaceStatus) => {
      expect(canMarkWorkspaceDone({ workspaceStatus }, statuses)).toBe(true)
    }
  )

  it('does not offer Done for a workspace that is already Done', () => {
    expect(canMarkWorkspaceDone({ workspaceStatus: 'completed' }, statuses)).toBe(false)
  })

  it('does not offer Done when the status list has no Done lane', () => {
    expect(
      canMarkWorkspaceDone(
        { workspaceStatus: 'todo' },
        statuses.filter((status) => status.id !== 'completed')
      )
    ).toBe(false)
  })
})
