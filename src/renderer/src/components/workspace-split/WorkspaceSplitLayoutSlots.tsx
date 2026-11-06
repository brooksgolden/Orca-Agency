import { TabGroupResizeHandle as ResizeHandle } from '../tab-group/TabGroupResizeHandle'
import { useCallback, useLayoutEffect, useRef } from 'react'
import type { WorkspaceLayoutNode, WorkspaceLayoutPath } from '@/lib/workspace-split-layout'
import { workspacePaneKey } from '@/lib/workspace-group-layout'

export type WorkspacePaneRect = { top: number; left: number; width: number; height: number }

function sameRects(a: Map<string, WorkspacePaneRect>, b: Map<string, WorkspacePaneRect>): boolean {
  if (a.size !== b.size) {
    return false
  }
  for (const [id, rect] of a) {
    const other = b.get(id)
    if (
      !other ||
      rect.top !== other.top ||
      rect.left !== other.left ||
      rect.width !== other.width ||
      rect.height !== other.height
    ) {
      return false
    }
  }
  return true
}

const ignoreResizeStart = () => {}

function SlotNode({
  node,
  path,
  register,
  onResizeStart,
  onRatioChange
}: {
  node: WorkspaceLayoutNode
  path: WorkspaceLayoutPath
  register: (id: string, element: HTMLDivElement | null) => void
  onResizeStart: () => void
  onRatioChange: (path: WorkspaceLayoutPath, ratio: number) => void
}): React.JSX.Element {
  if (node.type === 'leaf') {
    return (
      <div
        ref={(element) => register(workspacePaneKey(node), element)}
        data-workspace-slot={workspacePaneKey(node)}
        className="flex-1 min-w-0 min-h-0"
      />
    )
  }
  const horizontal = node.direction === 'horizontal'
  return (
    <div className={`flex flex-1 min-w-0 min-h-0 ${horizontal ? 'flex-row' : 'flex-col'}`}>
      <div
        className="relative flex min-w-0 min-h-0 overflow-hidden"
        style={{ flex: `${node.ratio} 1 0%` }}
      >
        <SlotNode
          node={node.first}
          path={[...path, 'first']}
          register={register}
          onResizeStart={onResizeStart}
          onRatioChange={onRatioChange}
        />
      </div>
      <ResizeHandle
        direction={node.direction}
        onResizeStart={onResizeStart}
        onRatioChange={(ratio) => onRatioChange(path, ratio)}
      />
      <div
        className="relative flex min-w-0 min-h-0 overflow-hidden"
        style={{ flex: `${1 - node.ratio} 1 0%` }}
      >
        <SlotNode
          node={node.second}
          path={[...path, 'second']}
          register={register}
          onResizeStart={onResizeStart}
          onRatioChange={onRatioChange}
        />
      </div>
    </div>
  )
}

export function WorkspaceSplitLayoutSlots({
  layout,
  onRectsChange,
  onResizeStart = ignoreResizeStart,
  onRatioChange,
  scope
}: {
  layout: WorkspaceLayoutNode
  onRectsChange: (rects: Map<string, WorkspacePaneRect>) => void
  onResizeStart?: () => void
  onRatioChange: (path: WorkspaceLayoutPath, ratio: number) => void
  scope?: 'tab-group'
}): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)
  const leavesRef = useRef(new Map<string, HTMLDivElement>())
  const lastRectsRef = useRef(new Map<string, WorkspacePaneRect>())
  const measure = useCallback(() => {
    const root = rootRef.current
    if (!root) {
      return
    }
    const bounds = root.getBoundingClientRect()
    if (bounds.width <= 0 || bounds.height <= 0) {
      return
    }
    const rects = new Map<string, WorkspacePaneRect>()
    for (const [id, element] of leavesRef.current) {
      const rect = element.getBoundingClientRect()
      rects.set(id, {
        top: rect.top - bounds.top,
        left: rect.left - bounds.left,
        width: rect.width,
        height: rect.height
      })
    }
    if (!sameRects(rects, lastRectsRef.current)) {
      lastRectsRef.current = rects
      onRectsChange(rects)
    }
  }, [onRectsChange])
  const register = useCallback((id: string, element: HTMLDivElement | null) => {
    if (element) {
      leavesRef.current.set(id, element)
    } else {
      leavesRef.current.delete(id)
    }
  }, [])
  useLayoutEffect(() => {
    const observer = new ResizeObserver(measure)
    if (rootRef.current) {
      observer.observe(rootRef.current)
    }
    for (const element of leavesRef.current.values()) {
      observer.observe(element)
    }
    measure()
    return () => {
      observer.disconnect()
    }
  }, [layout, measure])
  return (
    <div
      ref={rootRef}
      className="absolute inset-0 flex"
      data-workspace-split={!scope ? 'true' : undefined}
      data-tab-group-split={scope ? 'true' : undefined}
    >
      <SlotNode
        node={layout}
        path={[]}
        register={register}
        onResizeStart={onResizeStart}
        onRatioChange={onRatioChange}
      />
    </div>
  )
}
