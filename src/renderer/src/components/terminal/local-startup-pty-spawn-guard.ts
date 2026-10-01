import { useAppStore } from '@/store'
import { requestBackgroundTerminalWorktreeMount } from './background-terminal-worktree-mount'
import {
  clearLocalStartupPtyLiveness,
  findSavedPtyTabMounts,
  noteLocalStartupPtySpawned
} from './local-startup-pty-liveness'

/** Observe same-ID spawns before hydration starts, and release the listener with its boot effect. */
export function installLocalStartupPtySpawnGuard(): () => void {
  clearLocalStartupPtyLiveness()
  const unsubscribe = window.api.pty.onSpawned?.(({ id }) => {
    if (!noteLocalStartupPtySpawned(id)) {
      return
    }
    for (const mount of findSavedPtyTabMounts(useAppStore.getState(), id)) {
      requestBackgroundTerminalWorktreeMount(mount)
    }
  })
  return () => {
    unsubscribe?.()
    clearLocalStartupPtyLiveness()
  }
}
