import { hasVisibleOverlay } from '../visible-overlay'
import { sidebarListFocusIsClaimed } from '../sidebar-list-focus-claim'
import type { ManagedPane } from './pane-manager-types'

export function focusPanePreservingOverlays(
  pane: Pick<ManagedPane, 'container' | 'terminal'>
): void {
  // Why this is separate from the overlay test below: the workspace list is
  // always mounted, so it can never read as an overlay. A click on a workspace
  // card is still a real focus gesture, and a pane that mounts after it (a cold
  // workspace spawning its first PTY) must not yank that focus away. The claim
  // retires itself the moment focus leaves the list.
  if (sidebarListFocusIsClaimed()) {
    return
  }
  if (
    typeof document !== 'undefined' &&
    (document.activeElement?.matches('[data-worktree-sidebar][data-keyboard-navigation]') ||
      hasVisibleOverlay({
        ignoreMatches: '[role="listbox"][data-worktree-sidebar]',
        ignoreContaining: pane.container,
        ignoreDismissed: true
      }))
  ) {
    return
  }
  pane.terminal.focus()
}
