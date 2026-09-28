import type { AgentType } from '../../../../shared/agent-status-types'
import { resolvePaneAgentOwner } from '../../../../shared/pane-agent-owner'
import { makePaneKey } from '../../../../shared/stable-pane-id'
import type { TerminalLayoutSnapshot, TerminalTab } from '../../../../shared/terminal-tab-types'
import type { PaneForegroundAgentEntry } from '@/store/slices/pane-foreground-agent'

export function resolveTitleDerivedPaneOwner(
  tab: TerminalTab,
  layout: TerminalLayoutSnapshot | undefined,
  leafId: string,
  foregroundAgentsByPaneKey?: Record<string, PaneForegroundAgentEntry>
): AgentType | null {
  const foreground = foregroundAgentsByPaneKey?.[makePaneKey(tab.id, leafId)]
  if (foreground?.agent && foreground.processObserved === true && !foreground.shellForeground) {
    return foreground.agent
  }
  // A tab's launch identity belongs to a pane only while the tab has one leaf.
  if (layout?.root?.type !== 'leaf' || layout.root.leafId !== leafId) {
    return null
  }
  return resolvePaneAgentOwner({ launchAgent: tab.launchAgent })
}
