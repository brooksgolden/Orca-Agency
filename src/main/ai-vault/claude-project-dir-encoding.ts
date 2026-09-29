export { encodeClaudeProjectPath, encodeClaudeProjectPaths } from '../../shared/claude-project-path'

/** Why the explicit boundary: a bare `startsWith` lets a sibling prefix match, so the encoding of
 *  `…/orca` would claim `…/orca-secret` and `…/orcadyne` as its own. */
export function isClaudeProjectDirInScope(
  projectDirName: string,
  scopePrefixes: ReadonlySet<string> | readonly string[]
): boolean {
  for (const prefix of scopePrefixes) {
    if (projectDirName === prefix || projectDirName.startsWith(`${prefix}-`)) {
      return true
    }
  }
  return false
}
