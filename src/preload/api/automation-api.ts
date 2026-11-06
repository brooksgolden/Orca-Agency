import type { ExecutionHostId } from '../../shared/execution-host'
import type {
  AutomationDispatchRequest,
  AutomationDispatchResult,
  AutomationPrecheckResult,
  AutomationRun,
  ExternalAutomationManager,
  ExternalAutomationRunsPage
} from '../../shared/automations-types'
import type { AutomationOwnerRef } from '../../shared/automation-owner-ref'
import type {
  ScopedExternalManagerActionRequest,
  ScopedExternalManagerCreateRequest,
  ScopedExternalManagerListRequest,
  ScopedExternalManagerRunsRequest,
  ScopedExternalManagerUpdateRequest
} from '../../shared/external-automation-scope'
import type { AutomationsChangedPayload } from '../../shared/runtime-client-events'

export type ExternalAutomationManagerResult = {
  /** Null once a probe succeeded and found no manager configured for this scope. */
  manager: ExternalAutomationManager | null
  error: string | null
  updatedAt: number
}

// External manager operations are owner-scoped desktop IPC; CRUD and run history currently serve local Hermes only.
export type AutomationsApi = {
  listExternalManagerForOwner: (
    request: ScopedExternalManagerListRequest
  ) => Promise<ExternalAutomationManagerResult>
  listExternalRunsForOwner: (request: ScopedExternalManagerRunsRequest) => Promise<ExternalAutomationRunsPage>
  createExternalForOwner: (request: ScopedExternalManagerCreateRequest) => Promise<void>
  updateExternalForOwner: (request: ScopedExternalManagerUpdateRequest) => Promise<void>
  runExternalActionForOwner: (request: ScopedExternalManagerActionRequest) => Promise<void>
  retainExternalScopes: (request: { owners: readonly AutomationOwnerRef[] }) => Promise<void>
  runPrecheck: (args: {
    automationId: string
    runId: string
  }) => Promise<AutomationPrecheckResult | null>
  markDispatchResult: (result: AutomationDispatchResult) => Promise<AutomationRun>
  snapshotWorkspaceName: (args: {
    workspaceId: string
    hostId: ExecutionHostId
    displayName: string
  }) => Promise<number>
  rendererReady: () => Promise<void>
  onDispatchRequested: (callback: (request: AutomationDispatchRequest) => void) => () => void
  onChanged: (callback: (payload: AutomationsChangedPayload) => void) => () => void
}
