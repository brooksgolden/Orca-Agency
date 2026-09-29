import { normalizeRuntimePathSeparators } from './cross-platform-path'

/**
 * Why: Claude derives the directory name from the raw cwd, so encoding from the
 * comparison key would lowercase Windows paths and never match on disk. Encode
 * the raw path, plus its NFC spelling, since macOS hands us NFD (#10832).
 */
export function encodeClaudeProjectPaths(pathValue: string): string[] {
  const raw = encodeClaudeProjectPath(pathValue)
  const composed = encodeClaudeProjectPath(pathValue.normalize('NFC'))
  return raw === composed ? [raw] : [raw, composed]
}

/** One dash per non-alphanumeric character — runs are NOT collapsed, so `/.claude` encodes to
 *  `--claude` and `C:\` to `c--`. Anything that collapses runs stops matching real buckets. */
export function encodeClaudeProjectPath(pathValue: string): string {
  const separated = normalizeRuntimePathSeparators(pathValue)
  const trimmed =
    separated === '/' || /^[A-Za-z]:\/$/.test(separated) ? separated : separated.replace(/\/+$/, '')
  return trimmed.replace(/[^a-zA-Z0-9]/g, '-')
}

/** True when a Claude transcript sits in the bucket Claude reads for `cwd`. */
export function isClaudeTranscriptInProjectBucket(
  transcriptPath: string | null | undefined,
  cwd: string
): boolean {
  const bucket = transcriptPath?.split(/[\\/]/).at(-2)
  return bucket !== undefined && bucket !== '' && encodeClaudeProjectPaths(cwd).includes(bucket)
}
