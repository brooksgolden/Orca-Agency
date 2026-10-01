import type { Tab } from '../../../../shared/tab-types'
import type { TabBarProps } from '../tab-bar/tab-bar-props'

type ActiveTabSelection = Pick<
  TabBarProps,
  'activeTabId' | 'activeFileId' | 'activeBrowserTabId' | 'activeSimulatorTabId' | 'activeTabType'
>

/** Map the group's unified active tab to the visible IDs consumed by each tab strip kind. */
export function resolveTabGroupActiveTabSelection(
  activeTab: Tab | null | undefined
): ActiveTabSelection {
  return {
    activeTabId:
      activeTab?.contentType === 'terminal'
        ? activeTab.entityId
        : activeTab?.contentType === 'agent-session'
          ? activeTab.id
          : null,
    activeFileId:
      activeTab?.contentType === 'terminal' ||
      activeTab?.contentType === 'agent-session' ||
      activeTab?.contentType === 'browser' ||
      activeTab?.contentType === 'simulator'
        ? null
        : activeTab?.id,
    activeBrowserTabId: activeTab?.contentType === 'browser' ? activeTab.entityId : null,
    activeSimulatorTabId: activeTab?.contentType === 'simulator' ? activeTab.id : null,
    activeTabType:
      activeTab?.contentType === 'terminal'
        ? 'terminal'
        : activeTab?.contentType === 'agent-session'
          ? 'agent-session'
          : activeTab?.contentType === 'browser'
            ? 'browser'
            : activeTab?.contentType === 'simulator'
              ? 'simulator'
              : 'editor'
  }
}
