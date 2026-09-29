import { buildLinearIssueLinkedWorkItem } from '@/lib/linear-linked-work-item'
import type { LinkedWorkItemSummary } from '@/lib/new-workspace'
import { getLinearIssueWorkspaceName } from '../../../../shared/workspace-name'
import type { AppState } from '../../store/types'

type NewWorkspaceShortcutModalData = {
  telemetrySource: 'shortcut'
  chatMode?: boolean
  prefilledName?: string
  linkedWorkItem?: LinkedWorkItemSummary
}

type NewWorkspaceShortcutContext = Pick<AppState, 'activeView'> & {
  taskPageData: Pick<AppState['taskPageData'], 'openLinearIssue'>
  settings?: Pick<NonNullable<AppState['settings']>, 'chatSidebar'> | null
}

export function buildNewWorkspaceShortcutModalData(
  state: NewWorkspaceShortcutContext
): NewWorkspaceShortcutModalData {
  const linearIssue =
    state.activeView === 'tasks' ? (state.taskPageData.openLinearIssue ?? null) : null
  if (!linearIssue) {
    return {
      telemetrySource: 'shortcut',
      ...(state.settings?.chatSidebar?.view === 'chats' ? { chatMode: true } : {})
    }
  }

  return {
    telemetrySource: 'shortcut',
    prefilledName: getLinearIssueWorkspaceName(linearIssue),
    // Cmd+N from a Linear issue mirrors its Start-workspace action with source context.
    linkedWorkItem: buildLinearIssueLinkedWorkItem(linearIssue)
  }
}

export function openNewWorkspaceFromShortcut(
  state: NewWorkspaceShortcutContext & Pick<AppState, 'activeModal' | 'openModal'>
): void {
  if (state.activeModal === 'new-workspace-composer') {
    return
  }
  state.openModal('new-workspace-composer', buildNewWorkspaceShortcutModalData(state))
}
