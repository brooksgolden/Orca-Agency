import type { ExternalAutomationJob, ExternalAutomationManager, ExternalAutomationRun } from '../../../../shared/automations-types'
import type { ExternalAutomationScope } from './external-automation-scope-client'

/** Detail-pane tab shared by the page, its list panel, and the detail pane. */
export type AutomationPaneTab = 'overview' | 'runs'

/** Top-level surface within Automations. */
export type AutomationsPageView = 'automations' | 'runs' | 'run'

export type AutomationRunPageOrigin = 'runs' | 'automation'

export type SelectedExternalRunPage = {
  manager: ExternalAutomationManager
  job: ExternalAutomationJob
  run: ExternalAutomationRun
  scope: ExternalAutomationScope
}
