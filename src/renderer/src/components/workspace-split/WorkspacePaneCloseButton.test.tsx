// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'

const mocks = vi.hoisted(() => {
  const state = {
    workspaceSplitGroups: [],
    groupsByWorktree: {},
    updateWorktreeMeta: vi.fn().mockResolvedValue({ ok: true }),
    setActiveWorktree: vi.fn(),
    unsplitWorkspace: vi.fn(),
    mergeGroupIntoSibling: vi.fn(),
    reconcileWorkspaceSurfaceGroups: vi.fn()
  }
  const useAppStore = (selector: (value: typeof state) => unknown): unknown => selector(state)
  useAppStore.getState = () => state
  return {
    confirm: vi.fn(),
    setWorkspaceChatsCompleted: vi.fn().mockResolvedValue(undefined),
    isSplit: false,
    useAppStore
  }
})

vi.mock('@/store', () => ({ useAppStore: mocks.useAppStore }))
vi.mock('@/components/confirmation-dialog-context', () => ({
  useConfirmationDialog: () => mocks.confirm
}))
vi.mock('@/components/sidebar/chat-sidebar-preferences', () => ({
  setWorkspaceChatsCompleted: mocks.setWorkspaceChatsCompleted
}))
vi.mock('@/lib/worktree-activation', () => ({ activateAndRevealWorkspace: () => true }))
vi.mock('@/lib/workspace-split-layout', () => ({
  findWorkspaceSplitGroup: () => (mocks.isSplit ? { layout: {} } : null),
  findWorkspaceSplitPartner: () => (mocks.isSplit ? 'wt-partner' : null)
}))

import { WorkspacePaneCloseButton } from './WorkspacePaneCloseButton'

function renderButton(): void {
  render(
    <TooltipProvider>
      <WorkspacePaneCloseButton worktreeId="wt-1" />
    </TooltipProvider>
  )
}

describe('workspace close confirmation', () => {
  beforeEach(() => {
    mocks.isSplit = false
    mocks.confirm.mockReset()
    mocks.useAppStore.getState().updateWorktreeMeta.mockClear()
    mocks.setWorkspaceChatsCompleted.mockClear()
    mocks.useAppStore.getState().setActiveWorktree.mockClear()
    mocks.useAppStore.getState().unsplitWorkspace.mockClear()
  })

  afterEach(cleanup)

  it('marks the workspace Done and removes an unsplit workspace from the active window on Yes', async () => {
    mocks.confirm.mockResolvedValue(true)
    renderButton()

    fireEvent.click(screen.getByRole('button', { name: 'Close workspace' }))

    await waitFor(() =>
      expect(mocks.useAppStore.getState().updateWorktreeMeta).toHaveBeenCalledWith('wt-1', {
        workspaceStatus: 'completed'
      })
    )
    expect(mocks.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ confirmLabel: 'Yes', cancelLabel: 'No', showCloseButton: false })
    )
    expect(mocks.setWorkspaceChatsCompleted).toHaveBeenCalledWith('wt-1', true)
    expect(mocks.useAppStore.getState().setActiveWorktree).toHaveBeenCalledWith(null)
  })

  it('removes an unsplit workspace from the active window on No without marking it Done', async () => {
    mocks.confirm.mockImplementation(async (options: { onCancelClicked?: () => void }) => {
      options.onCancelClicked?.()
      return false
    })
    renderButton()

    fireEvent.click(screen.getByRole('button', { name: 'Close workspace' }))

    await waitFor(() =>
      expect(mocks.useAppStore.getState().setActiveWorktree).toHaveBeenCalledWith(null)
    )
    expect(mocks.useAppStore.getState().updateWorktreeMeta).not.toHaveBeenCalled()
    expect(mocks.setWorkspaceChatsCompleted).not.toHaveBeenCalled()
  })

  it('marks a split workspace Done and removes it from the split on Yes', async () => {
    mocks.isSplit = true
    mocks.confirm.mockResolvedValue(true)
    renderButton()

    fireEvent.click(screen.getByRole('button', { name: 'Close workspace' }))

    await waitFor(() =>
      expect(mocks.useAppStore.getState().updateWorktreeMeta).toHaveBeenCalledWith('wt-1', {
        workspaceStatus: 'completed'
      })
    )
    expect(mocks.useAppStore.getState().unsplitWorkspace).toHaveBeenCalledWith('wt-1')
    expect(mocks.setWorkspaceChatsCompleted).toHaveBeenCalledWith('wt-1', true)
  })

  it('removes a split workspace from the split on No without marking it Done', async () => {
    mocks.isSplit = true
    mocks.confirm.mockImplementation(async (options: { onCancelClicked?: () => void }) => {
      options.onCancelClicked?.()
      return false
    })
    renderButton()

    fireEvent.click(screen.getByRole('button', { name: 'Close workspace' }))

    await waitFor(() =>
      expect(mocks.useAppStore.getState().unsplitWorkspace).toHaveBeenCalledWith('wt-1')
    )
    expect(mocks.useAppStore.getState().updateWorktreeMeta).not.toHaveBeenCalled()
    expect(mocks.setWorkspaceChatsCompleted).not.toHaveBeenCalled()
  })

  it('removes a split workspace from the split when the prompt is dismissed without marking Done', async () => {
    mocks.isSplit = true
    mocks.confirm.mockResolvedValue(false)
    renderButton()

    fireEvent.click(screen.getByRole('button', { name: 'Close workspace' }))

    await waitFor(() =>
      expect(mocks.useAppStore.getState().unsplitWorkspace).toHaveBeenCalledWith('wt-1')
    )
    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ showCloseButton: true }))
    expect(mocks.useAppStore.getState().updateWorktreeMeta).not.toHaveBeenCalled()
  })
})
