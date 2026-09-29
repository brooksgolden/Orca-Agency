import { describe, expect, it } from 'vitest'
import type { ProjectGroup } from '../../../../shared/project-group-types'
import {
  chatCreationFolders,
  defaultChatFolder,
  hiddenChatFolderLabels
} from './chat-creation-folders'

function group(id: string, path: string | null, connectionId: string | null = null): ProjectGroup {
  return {
    id,
    name: 'Stale display name',
    parentPath: path,
    connectionId,
    parentGroupId: null,
    createdFrom: 'manual',
    tabOrder: 0,
    isCollapsed: false,
    color: null,
    createdAt: 1,
    updatedAt: 1
  }
}

describe('chat creation folders', () => {
  it('keeps a current directory filter when another group has the same old display name', () => {
    const groups = [
      group('one', '/work/Private'),
      { ...group('two', '/work/Public'), name: 'Private' }
    ]
    expect(hiddenChatFolderLabels(['Private'], groups)).toEqual(['Private'])
  })
  it('preserves hidden preferences across directory relabeling and gives root folders a label', () => {
    const groups = [group('one', 'C:/work/Client'), group('root', 'C:/')]
    expect(hiddenChatFolderLabels(['Stale display name', 'Other'], groups)).toEqual([
      'Client',
      'C:',
      'Other'
    ])
    expect(chatCreationFolders(groups).every((folder) => Boolean(folder.name))).toBe(true)
  })
  it('uses directory names and deduplicates a Windows directory without virtual groups', () => {
    const folders = chatCreationFolders([
      group('virtual', null),
      group('local', 'C:\\work\\Local Apps'),
      group('duplicate', 'c:/work/local apps/'),
      group('uncat', 'C:/work/Uncategorized')
    ])
    expect(folders.map((f) => [f.id, f.name])).toEqual([
      ['local', 'Local Apps'],
      ['uncat', 'Uncategorized']
    ])
  })

  it('does not collapse equal directory paths on different execution hosts', () => {
    expect(
      chatCreationFolders([group('one', '/work/Client'), group('two', '/work/Client', 'box')])
    ).toHaveLength(2)
  })

  it('defaults to the local Uncategorized directory regardless of input order', () => {
    const folders = chatCreationFolders([
      group('remote', '/work/Uncategorized', 'box'),
      group('client', 'C:/work/Client'),
      group('uncat', 'C:/work/Uncategorized')
    ])
    expect(defaultChatFolder(folders, undefined)?.id).toBe('uncat')
    expect(
      defaultChatFolder(folders, { projectGroupId: 'client', executionHostId: 'local' })?.id
    ).toBe('client')
    expect(
      defaultChatFolder(folders, { projectGroupId: 'remote', executionHostId: 'ssh:box' })?.id
    ).toBe('remote')
    expect(
      defaultChatFolder(folders, { projectGroupId: 'client', executionHostId: 'ssh:wrong' })?.id
    ).toBe('uncat')
  })

  it('does not silently select an unrelated folder if the default is gone', () => {
    expect(
      defaultChatFolder(chatCreationFolders([group('client', '/work/Client')]), undefined)
    ).toBeUndefined()
  })
})
