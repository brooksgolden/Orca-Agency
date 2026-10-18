import { expect, it, vi } from 'vitest'
import { createTerminalLatencyFileCapture } from './terminal-latency-file-capture'

it('keeps the newest bounded latency events when a diagnostic disk write stalls', async () => {
  let releaseFirst: () => void = () => {}
  const append = vi
    .fn<(path: string, line: string) => Promise<void>>()
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseFirst = resolve
        })
    )
    .mockResolvedValue(undefined)
  const capture = createTerminalLatencyFileCapture('fixture', append)
  capture('first')
  for (let index = 0; index < 40; index++) {
    capture(String(index))
  }

  expect(append).toHaveBeenCalledTimes(1)
  releaseFirst()
  await vi.waitFor(() => expect(append).toHaveBeenCalledTimes(33))
  expect(append.mock.calls[1][1]).toBe('8\n')
  expect(append.mock.calls[32][1]).toBe('39\n')
})

it('continues on a later event after a failed write', async () => {
  const append = vi
    .fn<(path: string, line: string) => Promise<void>>()
    .mockRejectedValueOnce(new Error('Disk unavailable'))
    .mockResolvedValue(undefined)
  const capture = createTerminalLatencyFileCapture('fixture', append)
  capture('first')
  await vi.waitFor(() => expect(append).toHaveBeenCalledTimes(1))
  capture('second')
  await vi.waitFor(() => expect(append).toHaveBeenCalledTimes(2))
  expect(append.mock.calls[1][1]).toBe('second\n')
})
