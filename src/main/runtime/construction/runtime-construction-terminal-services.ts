import type { OrcaRuntimeWithResolveTerminalPane } from '../terminal/recovery/resolve-terminal-pane'
import type { OrcaRuntimeWithControllerKnowsPtyIsLive } from '../terminal/input/terminal-input-dispatch'
import type { OrcaRuntimeWithMaybeHydrateHeadlessFromRenderer } from '../terminal/output/headless-terminal-hydration'
import type {
  AgentPromptActivity,
  AgentPromptWaitTextCache
} from '../agent-prompt-submission-verification'

export abstract class RuntimeConstructionTerminalServices {
  abstract getPtyOutputSequence(ptyId: string): number
  protected abstract getPtyLifecycleGeneration(ptyId: string): number
  protected abstract retirePtyAgentLaunchAuthority(ptyId: string): void
  abstract readTerminal(
    ...args: Parameters<OrcaRuntimeWithResolveTerminalPane['readTerminal']>
  ): ReturnType<OrcaRuntimeWithResolveTerminalPane['readTerminal']>
  abstract sendTerminal(
    ...args: Parameters<OrcaRuntimeWithControllerKnowsPtyIsLive['sendTerminal']>
  ): ReturnType<OrcaRuntimeWithControllerKnowsPtyIsLive['sendTerminal']>
  abstract sendTerminalAgentPrompt(
    ...args: Parameters<OrcaRuntimeWithControllerKnowsPtyIsLive['sendTerminalAgentPrompt']>
  ): ReturnType<OrcaRuntimeWithControllerKnowsPtyIsLive['sendTerminalAgentPrompt']>
  abstract readLaunchedAgentForeground(
    ...args: Parameters<
      OrcaRuntimeWithMaybeHydrateHeadlessFromRenderer['readLaunchedAgentForeground']
    >
  ): ReturnType<OrcaRuntimeWithMaybeHydrateHeadlessFromRenderer['readLaunchedAgentForeground']>
  protected abstract getAgentPromptActivity(
    handle: string,
    ptyId: string,
    waitTextCache?: AgentPromptWaitTextCache
  ): AgentPromptActivity
}
