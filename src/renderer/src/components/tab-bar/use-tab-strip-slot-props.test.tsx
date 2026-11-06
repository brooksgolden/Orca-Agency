// @vitest-environment happy-dom
import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const drag = vi.hoisted(() => ({ active: false }))
vi.mock('../tab-group/tab-drag-context', () => ({ useTabDragActive: () => drag.active }))

import { useTabStripSlotProps } from './use-tab-strip-slot-props'

describe('active tab slot during drag', () => {
  it('keeps its sizing identity while disabling sticky docking for the drag', () => {
    drag.active = false
    const { result, rerender } = renderHook(() => useTabStripSlotProps('tab-1', true))
    expect(result.current['data-active-tab-slot']).toBe('')
    expect(result.current['data-active-tab-dock']).toBe('')
    drag.active = true
    rerender()
    expect(result.current['data-active-tab-slot']).toBe('')
    expect(result.current['data-active-tab-dock']).toBeUndefined()
  })
})
