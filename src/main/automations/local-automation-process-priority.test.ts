import { describe, expect, it } from 'vitest'
import { automationProcessTreePids } from './local-automation-process-priority'

describe('local automation process priority', () => {
  it('includes only the automation terminal descendants', () => {
    expect(
      automationProcessTreePids(100, [
        { pid: 101, ppid: 100 },
        { pid: 102, ppid: 101 },
        { pid: 103, ppid: 100 },
        { pid: 201, ppid: 200 },
        { pid: 202, ppid: 201 }
      ]).sort((a, b) => a - b)
    ).toEqual([101, 102, 103])
  })
})
