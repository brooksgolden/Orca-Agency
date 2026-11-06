// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import AiVaultSessionDropLayer from './AiVaultSessionDropLayer'
import { isWebviewDragPassthroughActive } from '../browser-pane/host-guest/webview-drag-passthrough'
import {
  writeAiVaultSessionDragData,
  clearAiVaultSessionDragData
} from '@/lib/ai-vault-session-drag'

vi.mock('@/store', () => ({ useAppStore: { getState: () => ({}) } }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('@/i18n/i18n', () => ({
  i18n: { language: 'en' },
  translate: (_key: string, fallback: string) => fallback
}))
afterEach(() => {
  cleanup()
  clearAiVaultSessionDragData()
  document.body.replaceChildren()
})
function pane() {
  const body = document.createElement('div')
  body.dataset.worktreeId = 'owner'
  body.dataset.tabGroupBodyId = 'document'
  body.getBoundingClientRect = () => new DOMRect(100, 100, 400, 600)
  document.body.append(body)
  return body
}
function transfer() {
  const data = new DataTransfer()
  const drop = vi.fn()
  writeAiVaultSessionDragData(
    data,
    {
      agent: 'codex',
      sessionId: 'saved',
      command: 'codex resume saved',
      title: 'Saved chat',
      sidebarChat: true
    },
    drop
  )
  return { data, drop }
}
function dragEvent(type: string, data: DataTransfer) {
  return Object.assign(new Event(type, { bubbles: true, cancelable: true }), {
    clientX: 300,
    clientY: 300,
    dataTransfer: data
  })
}
it('accepts and previews only the owner under a window-level dragover, without an interactive overlay', () => {
  const body = pane()
  const { data, drop } = transfer()
  // Register a different, overlapping owner's listener first.
  const view = render(
    <>
      <AiVaultSessionDropLayer worktreeId="other" enabled />
      <AiVaultSessionDropLayer worktreeId="owner" enabled />
    </>
  )
  const event = dragEvent('dragover', data)
  fireEvent(body, event)
  expect(event.defaultPrevented).toBe(true)
  expect(data.dropEffect).toBe('copy')
  expect(
    view.container.querySelector('[data-worktree-id="owner"] .tab-drop-overlay')
  ).not.toBeNull()
  expect(view.container.querySelector('[data-worktree-id="other"] .tab-drop-overlay')).toBeNull()
  fireEvent(body, dragEvent('drop', data))
  expect(isWebviewDragPassthroughActive()).toBe(false)
  expect(drop).toHaveBeenCalledOnce()
  expect(drop).toHaveBeenCalledWith({
    worktreeId: 'owner',
    groupId: 'document',
    splitDirection: undefined
  })
})
it('does not accept, consume or preview a drag outside its own pane', () => {
  const body = pane()
  const { data, drop } = transfer()
  const view = render(<AiVaultSessionDropLayer worktreeId="other" enabled />)
  const event = dragEvent('dragover', data)
  fireEvent(body, event)
  expect(event.defaultPrevented).toBe(false)
  expect(view.container.querySelector('.tab-drop-overlay')).toBeNull()
  fireEvent(body, dragEvent('drop', data))
  expect(drop).not.toHaveBeenCalled()
})

it('releases guest passthrough after a missed native end from another window', () => {
  const body = pane()
  const { data } = transfer()
  render(<AiVaultSessionDropLayer worktreeId="owner" enabled />)
  fireEvent(body, dragEvent('dragenter', data))
  expect(isWebviewDragPassthroughActive()).toBe(true)
  fireEvent.pointerMove(window)
  expect(isWebviewDragPassthroughActive()).toBe(false)
})
it('releases only local preview state when the drag leaves this window', () => {
  const body = pane()
  const { data, drop } = transfer()
  render(<AiVaultSessionDropLayer worktreeId="owner" enabled />)
  fireEvent(body, dragEvent('dragenter', data))
  expect(isWebviewDragPassthroughActive()).toBe(true)
  fireEvent(window, Object.assign(dragEvent('dragleave', data), { relatedTarget: null }))
  expect(isWebviewDragPassthroughActive()).toBe(false)
  fireEvent(body, dragEvent('drop', data))
  expect(drop).toHaveBeenCalledOnce()
})
