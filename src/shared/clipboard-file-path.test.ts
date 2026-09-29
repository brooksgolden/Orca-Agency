import { describe, expect, it } from 'vitest'
import { clipboardFilePath } from './clipboard-file-path'

describe('file paths copied to the clipboard', () => {
  it.each([
    [
      'C:/Users/brook/dev/claude/General/hermes-bridge',
      'C:\\Users\\brook\\dev\\claude\\General\\hermes-bridge'
    ],
    ['C:\\Mixed/folder/file.md', 'C:\\Mixed\\folder\\file.md'],
    ['//server/share/My Folder/file.md', '\\\\server\\share\\My Folder\\file.md'],
    ['//wsl.localhost/Ubuntu/home/user/file.md', '\\\\wsl.localhost\\Ubuntu\\home\\user\\file.md'],
    ['/Users/brook/My Folder/file.md', '/Users/brook/My Folder/file.md'],
    ['/srv/client/back\\slash/file.md', '/srv/client/back\\slash/file.md'],
    ['https://example.com/file.md', 'https://example.com/file.md']
  ])('copies %s without losing the owning filesystem syntax', (input, expected) => {
    expect(clipboardFilePath(input)).toBe(expected)
  })

  it('uses the absolute file root for relative paths', () => {
    expect(clipboardFilePath('docs/readme.md', 'D:/client/docs/readme.md')).toBe('docs\\readme.md')
    expect(clipboardFilePath('docs/readme.md', '/srv/client/docs/readme.md')).toBe('docs/readme.md')
    expect(clipboardFilePath('docs/readme.md', '//wsl.localhost/Ubuntu/home/docs/readme.md')).toBe(
      'docs/readme.md'
    )
  })
})
