import type { Store } from '../persistence'
import type { Automation } from '../../shared/automations-types'

/** Keep a local scheduled occurrence due until the laptop is quiet and no other agent run owns it. */
export function canStartScheduledLocalAutomation(
  automation: Pick<Automation, 'executionTargetType'>,
  store: Pick<Store, 'listAutomations' | 'listAutomationRuns'>,
  ready: (() => boolean) | null
): boolean {
  if (automation.executionTargetType !== 'local' || !ready) {
    return true
  }
  if (!ready()) {
    return false
  }
  const localIds = new Set(
    store
      .listAutomations()
      .filter((item) => item.executionTargetType === 'local')
      .map((item) => item.id)
  )
  return !store
    .listAutomationRuns()
    .some(
      (run) =>
        localIds.has(run.automationId) &&
        (run.status === 'dispatching' || run.status === 'dispatched')
    )
}
