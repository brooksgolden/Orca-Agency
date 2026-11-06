import { describe, expect, it } from 'vitest'
import { appendBuildOldSpaceOption, getBuildOldSpaceSizeMb } from './node-old-space-limit.mjs'

const gib = 1024 * 1024 * 1024

describe('node old-space build limit', () => {
  it('caps larger hosts at the release-runner build heap', () => {
    expect(getBuildOldSpaceSizeMb(8 * gib)).toBe(4096)
  })

  it('reserves memory for smaller arm64 hosts', () => {
    expect(getBuildOldSpaceSizeMb(4 * gib)).toBe(3072)
  })

  it('keeps existing NODE_OPTIONS while appending the build heap limit last', () => {
    expect(appendBuildOldSpaceOption('--trace-warnings --max-old-space-size=8192', 4 * gib)).toBe(
      '--trace-warnings --max-old-space-size=8192 --max-old-space-size=3072'
    )
  })

  it('preserves a smaller caller heap limit', () => {
    expect(appendBuildOldSpaceOption('--trace-warnings --max-old-space-size=2048', 8 * gib)).toBe(
      '--trace-warnings --max-old-space-size=2048 --max-old-space-size=2048'
    )
    expect(appendBuildOldSpaceOption('--max_old_space_size=1536', 8 * gib)).toBe(
      '--max_old_space_size=1536 --max-old-space-size=1536'
    )
  })

  it('keeps the smallest caller limit when Node options contain two', () => {
    expect(
      appendBuildOldSpaceOption('--max_old_space_size=3072 --max-old-space-size=2048', 8 * gib)
    ).toBe('--max_old_space_size=3072 --max-old-space-size=2048 --max-old-space-size=2048')
    expect(
      appendBuildOldSpaceOption('--max_old_space_size=1536 --max-old-space-size=3072', 8 * gib)
    ).toBe('--max_old_space_size=1536 --max-old-space-size=3072 --max-old-space-size=1536')
  })
})
