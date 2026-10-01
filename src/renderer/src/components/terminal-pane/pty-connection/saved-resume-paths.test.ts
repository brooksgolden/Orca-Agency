import { describe, expect, it } from 'vitest'
import { savedResumePaths } from './saved-resume-paths'
import { chatSession } from '../../sidebar/chat-sidebar-test-fixtures'

describe('cold conversation paths', () => {
  it('uses the Claude transcript bucket when a stored cwd is stale', () => {
    const saved = chatSession('claude', {
      agent: 'claude',
      cwd: '/old',
      filePath: '/home/.claude/projects/-new/chat.jsonl'
    })
    expect(savedResumePaths(saved, '/new', 'linux')).toEqual({ cwd: '/new', codexHome: null })
    expect(savedResumePaths(saved, '/other', 'linux')).toBeNull()
  })
  it('preserves an existing Claude bucket independently of the workspace display folder', () => {
    const saved = chatSession('claude', {
      agent: 'claude',
      cwd: 'C:/Original',
      filePath: 'C:/Users/me/.claude/projects/C--Original/chat.jsonl'
    })
    expect(savedResumePaths(saved, 'C:/Assigned', 'win32')?.cwd).toBe('C:/Original')
  })
  it('translates a WSL home only on the matching distro', () => {
    const saved = chatSession('codex', { codexHome: '//wsl.localhost/Ubuntu/home/me/.codex' })
    expect(savedResumePaths(saved, '/work', 'linux', 'Ubuntu')?.codexHome).toBe('/home/me/.codex')
    expect(savedResumePaths(saved, '/work', 'linux', 'Debian')).toBeNull()
    expect(savedResumePaths(saved, '/work', 'linux')).toBeNull()
    expect(savedResumePaths(saved, 'C:/work', 'win32')?.codexHome).toBe(saved.codexHome)
  })
})
