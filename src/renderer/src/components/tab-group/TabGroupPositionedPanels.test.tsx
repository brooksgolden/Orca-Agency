// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { TabGroupPositionedPanels } from './TabGroupPositionedPanels'

const mounts = vi.hoisted(() => new Map<string, number>())
vi.mock('@/store', () => ({
  useAppStore: { getState: () => ({ setTabGroupSplitRatio: vi.fn() }) }
}))
vi.mock('../workspace-split/WorkspaceSplitLayoutSlots', () => ({
  WorkspaceSplitLayoutSlots: () => null
}))
vi.mock('./TabGroupPanel', async () => {
  const { createElement, useState, useEffect } = await import('react')
  return {
    default: function EditorPanelDouble({ groupId }: { groupId: string }) {
      const [value, setValue] = useState('Original text')
      useEffect(() => {
        mounts.set(groupId, (mounts.get(groupId) ?? 0) + 1)
      }, [groupId])
      return createElement('input', {
        'aria-label': groupId,
        value,
        onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
          setValue(event.currentTarget.value)
      })
    }
  }
})
afterEach(() => {
  cleanup()
  mounts.clear()
})

it('retains the exact editor DOM and uncommitted content when local groups become independent window panes', () => {
  const props = {
    layout: {
      type: 'split' as const,
      direction: 'horizontal' as const,
      first: { type: 'leaf' as const, groupId: 'chat' },
      second: { type: 'leaf' as const, groupId: 'markdown' }
    },
    worktreeId: 'owner',
    focusedGroupId: 'markdown',
    isWorktreeActive: true,
    isWorktreeFocused: true,
    reserveLeftWindowChrome: true,
    reserveRightWindowChrome: true,
    isTabDragActive: false,
    hoveredTabInsertion: null
  }
  const view = render(<TabGroupPositionedPanels {...props} />)
  const editor = view.getByLabelText('markdown')
  fireEvent.change(editor, { target: { value: 'Buffered edit before autosave' } })
  const positions = new Map([
    [
      'chat',
      {
        left: 0,
        top: 400,
        width: 600,
        height: 400,
        topEdge: false,
        leftEdge: true,
        rightEdge: false,
        bottomEdge: true
      }
    ],
    [
      'markdown',
      {
        left: 600,
        top: 0,
        width: 600,
        height: 800,
        topEdge: true,
        leftEdge: false,
        rightEdge: true,
        bottomEdge: true
      }
    ]
  ])
  view.rerender(<TabGroupPositionedPanels {...props} positions={positions} />)
  expect(view.getByLabelText('markdown')).toBe(editor)
  expect(view.getByLabelText('markdown')).toHaveProperty('value', 'Buffered edit before autosave')
  expect(editor.parentElement?.style.left).toBe('600px')
  expect(editor.parentElement?.style.height).toBe('800px')
  expect(mounts.get('markdown')).toBe(1)
  expect(mounts.get('chat')).toBe(1)
})
