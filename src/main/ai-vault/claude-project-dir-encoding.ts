export { encodeClaudeProjectPath, encodeClaudeProjectPaths } from '../../shared/claude-project-path'

/** Require an encoded separator boundary so orca cannot match its sibling orcadyne. */
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
