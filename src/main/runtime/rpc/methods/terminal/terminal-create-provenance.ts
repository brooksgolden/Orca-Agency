import type { OrcaRuntimeService } from '../../../orca-runtime'
import type { RuntimeTerminalCreate } from '../../../../../shared/runtime-terminal-contracts'
import { isAgentPane, recordAgentSpawnedChat } from '../../../../automations/agent-spawn-provenance'

/**
 * Records that an agent created this terminal. The caller is an injected agent session id (structured
 * workers), or the calling terminal's handle when that pane runs a live agent. A plain shell pane has no
 * agent, so a person may have typed the command; that terminal is left unrecorded and stays visible.
 */
export function noteTerminalCreateProvenance(
  runtime: OrcaRuntimeService,
  params: { spawnerSessionId?: string; spawnerTerminalHandle?: string },
  terminal: RuntimeTerminalCreate
): void {
  if (!params.spawnerSessionId) {
    const caller = params.spawnerTerminalHandle
      ? runtime.terminalPaneIdentity(params.spawnerTerminalHandle)
      : null
    if (!caller || !isAgentPane(caller.paneKey)) {
      return
    }
  }
  recordAgentSpawnedChat({
    hostId: terminal.executionHostId ?? 'local',
    tabId: terminal.tabId ?? null,
    paneKey: terminal.paneKey ?? null
  })
}
