import type { ChatSidebarSessionSnapshot } from '../../../../../shared/chat-sidebar-settings'
import { isClaudeTranscriptInProjectBucket } from '../../../../../shared/claude-project-path'
import { parseWslUncPath, toLinuxPath } from '../../../../../shared/wsl-paths'

export function savedResumePaths(
  saved: ChatSidebarSessionSnapshot,
  workspacePath: string | undefined,
  platform: NodeJS.Platform,
  wslDistro?: string
): { cwd: string | null; codexHome: string | null } | null {
  const normalize = (path: string | null): string | null => {
    if (!path || platform !== 'linux' || saved.executionHostId !== 'local') {
      return path
    }
    const unc = parseWslUncPath(path)
    return unc ? unc.linuxPath : wslDistro ? toLinuxPath(path) : path
  }
  for (const path of [saved.filePath, saved.codexHome, saved.cwd]) {
    const unc = path && parseWslUncPath(path)
    if (
      unc &&
      platform === 'linux' &&
      (!wslDistro || unc.distro.toLowerCase() !== wslDistro.toLowerCase())
    ) {
      return null
    }
  }
  const cwd =
    [normalize(saved.cwd), normalize(workspacePath ?? null)].find(
      (path) => path && isClaudeTranscriptInProjectBucket(saved.filePath, path)
    ) ?? null
  if (saved.agent === 'claude' && !cwd) {
    return null
  }
  return {
    cwd: saved.agent === 'claude' ? cwd : null,
    codexHome: saved.agent === 'codex' ? normalize(saved.codexHome) : null
  }
}
