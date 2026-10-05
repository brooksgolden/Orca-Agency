import { describe, expect, it } from 'vitest'
import { batchOxlintFiles } from './oxlint-file-batches.mjs'

describe('Windows Oxlint argument budget', () => {
  it('scans every changed file once in bounded batches', () => {
    const files = ['a'.repeat(8), 'b'.repeat(8), 'c'.repeat(8), 'd'.repeat(8), 'e'.repeat(8)]
    const batches = batchOxlintFiles(files, 22)

    expect(batches).toEqual([files.slice(0, 2), files.slice(2, 4), files.slice(4)])
    expect(batches.flat()).toEqual(files)
    expect(
      batches.every((batch) => batch.reduce((size, file) => size + file.length + 3, 0) <= 22)
    ).toBe(true)
  })

  it('rejects a single file that exceeds the budget', () => {
    expect(() => batchOxlintFiles(['long-file.ts'], 10)).toThrow('argument budget')
  })
})
