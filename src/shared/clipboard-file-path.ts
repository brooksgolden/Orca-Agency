import { isWindowsAbsolutePathLike } from './cross-platform-path'
import { isWslUncPath } from './wsl-paths'

/** The file's root decides separators; the client may be viewing a different OS over SSH. */
export function clipboardFilePath(value: string, absolutePath = value): string {
  if (value !== absolutePath && isWslUncPath(absolutePath)) {
    return value
  }
  return isWindowsAbsolutePathLike(absolutePath) ? value.replace(/\//g, '\\') : value
}
