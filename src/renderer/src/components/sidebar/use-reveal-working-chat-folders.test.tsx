// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { useAppStore } from '@/store'
import { chatSidebarListItems } from './chat-sidebar-groups'
import { chatRow, chatState } from './chat-sidebar-test-fixtures'
import { useChatSidebarSectionToggle } from './use-chat-sidebar-section-toggle'
import { useRevealWorkingChatFolders } from './use-reveal-working-chat-folders'

const initialState = useAppStore.getInitialState()
const id = 'chat:folder:Acme'
const persist = vi.fn().mockResolvedValue(undefined)
function folderState() {
  const state = chatState()
  return {
    ...state,
    settings: {
      ...state.settings!,
      chatSidebar: { groupBy: 'folder', collapseDoneFolders: true } as const
    }
  }
}

function renderFolder() {
  return renderHook(
    ({ working, query }) => {
      const collapsed = useAppStore((s) => s.collapsedGroups)
      const items = chatSidebarListItems(
        [chatRow({ state: working ? 'working' : 'idle' })],
        folderState(),
        query,
        [],
        collapsed
      )
      useRevealWorkingChatFolders(items, query)
      const toggle = useChatSidebarSectionToggle()
      const heading = items.find((item) => item.kind === 'heading')
      return { heading, toggle }
    },
    { initialProps: { working: false, query: '' } }
  )
}

describe('working chat folder reveal', () => {
  beforeEach(() => {
    useAppStore.setState({ ...initialState, collapsedGroups: new Set([id]) }, true)
    persist.mockClear()
    Object.assign(window, { api: { ui: { set: persist } } })
  })

  afterEach(() => {
    cleanup()
    useAppStore.setState(initialState, true)
  })

  it('reveals new work once, then respects a manual chevron click through status refreshes', () => {
    const view = renderFolder()
    expect(view.result.current.heading?.collapsed).toBe(true)
    view.rerender({ working: true, query: '' })
    expect(view.result.current.heading?.collapsed).toBe(false)
    act(() => {
      const heading = view.result.current.heading
      if (!heading) {
        throw new Error('Folder heading missing')
      }
      view.result.current.toggle(heading)
    })
    view.rerender({ working: true, query: '' })
    expect(view.result.current.heading?.collapsed).toBe(true)
    expect(persist).toHaveBeenLastCalledWith({ collapsedGroups: [id] })
    view.rerender({ working: false, query: '' })
    view.rerender({ working: true, query: '' })
    expect(view.result.current.heading?.collapsed).toBe(false)
  })

  it('keeps a manually collapsed working folder collapsed when the sidebar remounts', () => {
    const view = renderFolder()
    view.rerender({ working: true, query: '' })
    act(() => useAppStore.getState().toggleCollapsedGroup(id))
    view.unmount()
    renderHook(() => {
      const items = chatSidebarListItems(
        [chatRow({ state: 'working' })],
        folderState(),
        '',
        [],
        useAppStore.getState().collapsedGroups
      )
      useRevealWorkingChatFolders(items, '')
    })
    expect(useAppStore.getState().collapsedGroups.has(id)).toBe(true)
  })

  it('does not reopen a working folder just because a search was cleared', () => {
    const view = renderFolder()
    view.rerender({ working: true, query: '' })
    act(() => useAppStore.getState().toggleCollapsedGroup(id))
    view.rerender({ working: true, query: 'missing' })
    view.rerender({ working: true, query: '' })
    expect(view.result.current.heading?.collapsed).toBe(true)
  })
})
