import { describe, expect, it, vi } from 'vitest'
import type { AppState } from '../types'
import type { TerminalActions } from './terminal-actions'
import { resolveTerminalCreatedShell } from './terminal-created-shell'

const mocks = vi.hoisted(() => ({
  getProjectRuntimeFolder: vi.fn(() => null)
}))

vi.mock('@/lib/local-project-runtime-workspace', () => ({
  getProjectRuntimeFolder: mocks.getProjectRuntimeFolder,
  getLocalProjectExecutionRuntimeContext: vi.fn(() => undefined)
}))

vi.mock('./terminal-workspace-routing', () => ({
  getRemoteConnectionIdForWorktree: vi.fn(() => null),
  resolveCreatedTabShellOverride: vi.fn(() => undefined),
  worktreeUsesWslPath: vi.fn(() => false)
}))

describe('resolveTerminalCreatedShell', () => {
  it('uses the requested execution host when creation facts have not arrived yet', () => {
    const options = {
      executionHostId: 'runtime:paired-host'
    } as Parameters<TerminalActions['createTab']>[3]

    resolveTerminalCreatedShell({} as AppState, 'folder:workspace', undefined, options, undefined)

    expect(mocks.getProjectRuntimeFolder).toHaveBeenCalledWith(
      expect.anything(),
      'folder:workspace',
      'runtime:paired-host'
    )
  })
})
