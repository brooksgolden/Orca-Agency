import type { OrcaRuntimeWithGetUnpersistedTrackedTitleForPty } from './terminal/output/terminal-title-tracker'

const pendingByOwner = new WeakMap<
  OrcaRuntimeWithGetUnpersistedTrackedTitleForPty,
  Map<string, ReturnType<typeof setTimeout>>
>()

export function scheduleNativeIdleTitleSettlement(
  owner: OrcaRuntimeWithGetUnpersistedTrackedTitleForPty,
  ptyId: string,
  delayMs: number,
  settle: () => void
): void {
  let pending = pendingByOwner.get(owner)
  if (!pending) {
    pending = new Map()
    pendingByOwner.set(owner, pending)
  }
  const previous = pending.get(ptyId)
  if (previous) {
    clearTimeout(previous)
  }
  const timer = setTimeout(() => {
    pending.delete(ptyId)
    settle()
  }, delayMs)
  timer.unref?.()
  pending.set(ptyId, timer)
}
