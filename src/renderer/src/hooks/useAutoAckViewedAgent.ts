import { useReadOnScreenAttention } from './useReadOnScreenAttention'

/**
 * Thin adapter kept for the Agency session-grid and away tests. The viewed-agent ack scan
 * (including the session-grid rescan) now lives in on-screen-attention-scan.ts behind
 * useReadOnScreenAttention.
 */
export function useAutoAckViewedAgent(): void {
  useReadOnScreenAttention()
}
