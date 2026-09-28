import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  collectWorkspaceIds,
  findWorkspaceSplitGroup,
  findWorkspaceSplitPartner,
  placeWorkspaceAtEdge,
  readWorkspaceSplitGroups,
  removeWorkspaceFromSplit,
  setWorkspaceSplitRatio,
  writeWorkspaceSplitGroups,
  type WorkspaceSplitGroup
} from './workspace-split-layout'

describe('workspace split layout', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('opens the same arrangement from either member and leaves the partner when unsplitting', () => {
    const paired = placeWorkspaceAtEdge([], 'project-b', 'project-a', 'right', 'view-1')
    expect(findWorkspaceSplitGroup(paired, 'project-a')).toBe(paired[0])
    expect(findWorkspaceSplitGroup(paired, 'project-b')).toBe(paired[0])
    expect(collectWorkspaceIds(paired[0].layout)).toEqual(['project-a', 'project-b'])
    expect(findWorkspaceSplitPartner(paired, 'project-b')).toBe('project-a')
    expect(removeWorkspaceFromSplit(paired, 'project-b')).toEqual([])
  })

  it('supports four workspaces, moving one to a different edge without duplicating it', () => {
    let groups = placeWorkspaceAtEdge([], 'b', 'a', 'right', 'view-1')
    groups = placeWorkspaceAtEdge(groups, 'c', 'a', 'bottom', 'unused')
    groups = placeWorkspaceAtEdge(groups, 'd', 'b', 'top', 'unused')
    expect(collectWorkspaceIds(groups[0].layout)).toEqual(['a', 'c', 'd', 'b'])
    groups = placeWorkspaceAtEdge(groups, 'b', 'c', 'left', 'unused')
    expect(collectWorkspaceIds(groups[0].layout)).toEqual(['a', 'b', 'c', 'd'])
    expect(new Set(collectWorkspaceIds(groups[0].layout)).size).toBe(4)
  })

  it('keeps independent arrangements when one is changed', () => {
    const first = placeWorkspaceAtEdge([], 'b', 'a', 'right', 'view-1')
    const both = placeWorkspaceAtEdge(first, 'd', 'c', 'bottom', 'view-2')
    expect(both).toHaveLength(2)
    const changed = removeWorkspaceFromSplit(both, 'b')
    expect(changed).toHaveLength(1)
    expect(findWorkspaceSplitGroup(changed, 'c')?.id).toBe('view-2')
    expect(findWorkspaceSplitGroup(changed, 'd')?.id).toBe('view-2')
  })

  it('clamps resizing the chosen split', () => {
    const groups = placeWorkspaceAtEdge([], 'b', 'a', 'right', 'view-1')
    const resized = setWorkspaceSplitRatio(groups, 'view-1', [], 0.99)
    expect(resized[0].layout).toMatchObject({ type: 'split', ratio: 0.85 })
  })

  it('caps workspace leaves at 16', () => {
    let groups: WorkspaceSplitGroup[] = placeWorkspaceAtEdge([], 'b', 'a', 'right', 'view-1')
    for (let index = 0; index < 14; index += 1) {
      groups = placeWorkspaceAtEdge(groups, `extra-${index}`, 'a', 'bottom', 'unused')
    }
    expect(collectWorkspaceIds(groups[0].layout)).toHaveLength(16)
    const overLimit = placeWorkspaceAtEdge(groups, 'overflow', 'a', 'right', 'unused')
    expect(collectWorkspaceIds(overLimit[0].layout)).toHaveLength(16)
  })

  it('restores independent groups without treating 16 as a global storage limit', () => {
    let stored = ''
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => stored,
        setItem: (_key: string, value: string) => {
          stored = value
        }
      }
    })
    let groups = placeWorkspaceAtEdge([], 'a-1', 'a-0', 'right', 'view-a')
    for (let index = 2; index < 16; index += 1) {
      groups = placeWorkspaceAtEdge(groups, `a-${index}`, 'a-0', 'bottom', 'unused')
    }
    groups = placeWorkspaceAtEdge(groups, 'b-1', 'b-0', 'right', 'view-b')
    writeWorkspaceSplitGroups(groups)
    expect(readWorkspaceSplitGroups()).toEqual(groups)
  })
})
