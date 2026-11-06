import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as AgentLauncher from './automation-chat-agent-launch'
import type { HeadlessAutomationDispatcher } from './headless-dispatch'
import type { AutomationRunTerminalObserver } from './run-completion-watcher'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import type { Store } from '../persistence/loading-store/store'
import { buildProfileStateCutoverFixture } from '../persistence/profile-state-cutover-fixture'
import { automationRunOperationId } from './automation-run-operation'

type Options = {
  headlessDispatcher?: HeadlessAutomationDispatcher
  chatDispatcher?: HeadlessAutomationDispatcher
  terminalObserver?: AutomationRunTerminalObserver
  allowRemoteHostScheduling?: boolean
  precheckMayContinue?: () => boolean
}
const captured = vi.hoisted(() => {
  const options: Options = {}
  return {
    options,
    launch: vi.fn(),
    observeChat: vi.fn(),
    markDispatchResult: vi.fn()
  }
})
const priorityMocks = vi.hoisted(() => ({
  lower: vi.fn(async () => {}),
  schedule: vi.fn()
}))

vi.mock('./local-automation-process-priority', () => ({
  lowerLocalAutomationProcessPriority: priorityMocks.lower,
  scheduleLocalAutomationPriorityFollowups: priorityMocks.schedule
}))

vi.mock('./service', () => ({
  AutomationService: class {
    markDispatchResult = captured.markDispatchResult
    start(): void {}
    stop(): void {}
    constructor(_store: unknown, opts: Options) {
      captured.options = opts
    }
  }
}))
vi.mock('./automation-chat-agent-launch', async (original) => ({
  ...(await original<typeof AgentLauncher>()),
  launchAutomationChatAgent: captured.launch
}))
vi.mock('./runtime-chat-run-observer', () => ({ observeAutomationChatRun: captured.observeChat }))
import { createRuntimeAutomationService } from './runtime-automation-service'
const state = buildProfileStateCutoverFixture('/fixture')
const run = {
  ...state.automationRuns[0],
  createdAt: 1_700_000_000_000,
  status: 'dispatching' as const,
  chatSessionId: null
}
function fixture(headless: boolean, definitionSurface: 'chat' | 'terminal' = 'chat') {
  const rows = new Map<string, unknown>()
  const records = {
    getOperationRow: (_caller: string, id: string) => rows.get(id),
    getConversation: () => ({
      sessionId: 'claude_chat',
      provider: 'claude',
      location: { workspaceId: 'wt-1' }
    })
  }
  const runtime = {
    setAutomationService: vi.fn(),
    notifyAutomationsChanged: vi.fn(),
    openAgentSessionRecordStore: async () => records,
    openedAgentSessionRecordStore: () => records,
    getTerminalHandleForPaneKey: vi.fn((_pane: string): string | null => null),
    getTerminalPtyIdForHandle: vi.fn((_handle: string): string | null => 'pty-1'),
    getTerminalPaneKey: vi.fn(
      () => '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d:3f2504e0-4f89-41d3-9a0c-0305e82c3301'
    ),
    waitForTerminal: vi.fn(async () => ({ state: 'done' })),
    getAgentStatusRowsForPane: vi.fn(() => [])
  }
  createRuntimeAutomationService({
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: construction and recovery use only these store boundaries.
    store: {
      listAutomationRuns: () => [],
      listAutomations: () => [
        { id: run.automationId, agentId: 'claude', surface: definitionSurface }
      ]
    } as unknown as Store,
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: launching and chat observation are mocked; the runtime implements the recovery boundaries.
    runtime: runtime as unknown as OrcaRuntimeService,
    headless
  })
  return { runtime, rows }
}
beforeEach(() => {
  vi.clearAllMocks()
  captured.markDispatchResult.mockImplementation(async (result) => ({ ...run, ...result }))
  captured.observeChat.mockResolvedValue({ status: 'completed' })
})
describe('host-owned automation execution', () => {
  it.each([false, true])(
    'uses the same Chat dispatcher on desktop/headless=%s without supplying a desktop Terminal dispatcher',
    async (headless) => {
      fixture(headless)
      captured.launch.mockResolvedValue({
        workspaceId: 'wt-1',
        terminalSessionId: 'tab-1',
        terminalPaneKey:
          '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d:3f2504e0-4f89-41d3-9a0c-0305e82c3301',
        terminalHandle: 'term-1'
      })
      expect(Boolean(captured.options.headlessDispatcher)).toBe(headless)
      const dispatcher = captured.options.chatDispatcher!
      const result = await dispatcher({
        automation: { ...state.automations[0], surface: 'chat' },
        run,
        target: { ok: true, cwd: '/fixture', repo: state.repos[0] }
      })
      expect(result.completion).toBeUndefined()
      expect(captured.launch).toHaveBeenCalledOnce()
      expect(
        captured.options.terminalObserver!.resolveRunTerminal({
          ...run,
          status: 'dispatched',
          terminalPaneKey:
            '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d:3f2504e0-4f89-41d3-9a0c-0305e82c3301'
        })
      ).toBe('term-1')
    }
  )
  it.each(['fresh-launch', 'reuse-send'] as const)(
    'recovers a %s accepted chat before the automation run identity was saved',
    async (purpose) => {
      const { rows } = fixture(false, purpose === 'fresh-launch' ? 'terminal' : 'chat')
      rows.set(automationRunOperationId(run, purpose), {
        outcome: {
          status: 'succeeded',
          sessionId: 'claude_chat',
          ...(purpose === 'fresh-launch'
            ? {
                launch: {
                  worktreeId: 'wt-1',
                  outcome: { kind: 'structured', sessionId: 'claude_chat', handle: 'chat-tab' },
                  receipt: {
                    mode: 'structured',
                    preferred: 'structured',
                    reason: 'requested',
                    detail: 'Chat'
                  },
                  prompt: { delivery: 'submit', outcome: 'journaled', messageId: 'opening' }
                }
              }
            : {})
        }
      })
      const observer = captured.options.terminalObserver!
      const handle = observer.resolveRunTerminal(run)!
      expect(
        await observer.observeCompletion(handle, { run, signal: new AbortController().signal })
      ).toEqual({ status: 'completed' })
      expect(captured.markDispatchResult).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionKind: 'chat',
          chatSessionId: 'claude_chat',
          terminalPaneKey: null,
          terminalSessionId: null,
          terminalPtyId: null
        })
      )
      expect(captured.observeChat).toHaveBeenCalledOnce()
      expect(captured.launch).not.toHaveBeenCalled()
    }
  )
  it('recovers an accepted Chat request that actually fell back to Terminal without relaunch', async () => {
    const { rows, runtime } = fixture(false, 'terminal')
    rows.set(automationRunOperationId(run, 'fresh-launch'), {
      outcome: {
        status: 'succeeded',
        launch: {
          worktreeId: 'wt-1',
          outcome: {
            kind: 'terminal',
            handle: 'term-fallback',
            paneKey: 'tab:11111111-1111-4111-8111-111111111111'
          },
          receipt: {
            mode: 'terminal',
            preferred: 'structured',
            reason: 'unsupported',
            detail: 'Fallback'
          },
          prompt: { delivery: 'submit', outcome: 'handed-to-terminal' }
        }
      }
    })
    runtime.waitForTerminal.mockRejectedValueOnce(new Error('ordinary-terminal-observer'))
    const observer = captured.options.terminalObserver!
    await expect(
      observer.observeCompletion(observer.resolveRunTerminal(run)!, {
        run,
        signal: new AbortController().signal
      })
    ).rejects.toThrow('ordinary-terminal-observer')
    expect(captured.markDispatchResult).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'dispatched',
        sessionKind: 'terminal',
        terminalPtyId: 'pty-1'
      })
    )
    expect(runtime.waitForTerminal).toHaveBeenCalledWith('term-fallback', expect.anything())
    expect(captured.observeChat).not.toHaveBeenCalled()
    expect(captured.launch).not.toHaveBeenCalled()
  })
  it.each(['chat', 'terminal'] as const)(
    'recovers a published failed %s receipt without accepting or sending it',
    async (kind) => {
      const { rows, runtime } = fixture(false)
      rows.set(automationRunOperationId(run, 'fresh-launch'), {
        outcome: {
          status: 'succeeded',
          launch: {
            worktreeId: 'actually-published',
            outcome:
              kind === 'chat'
                ? { kind: 'structured', sessionId: 'claude_published', handle: 'chat-tab' }
                : {
                    kind: 'terminal',
                    handle: 'term-published',
                    paneKey: 'tab:11111111-1111-4111-8111-111111111111'
                  },
            receipt: {
              mode: kind === 'chat' ? 'structured' : 'terminal',
              preferred: 'structured',
              reason: 'requested',
              detail: 'Published'
            },
            prompt: { delivery: 'submit', outcome: 'unconfirmed' }
          }
        }
      })
      const observer = captured.options.terminalObserver!
      expect(
        await observer.observeCompletion(observer.resolveRunTerminal(run)!, {
          run,
          signal: new AbortController().signal
        })
      ).toMatchObject({ status: 'dispatch_failed' })
      expect(captured.markDispatchResult).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: 'actually-published',
          status: 'dispatch_failed',
          sessionKind: kind,
          ...(kind === 'chat'
            ? { chatSessionId: 'claude_published', terminalPaneKey: null }
            : {
                terminalSessionId: 'tab',
                terminalPaneKey: 'tab:11111111-1111-4111-8111-111111111111'
              })
        })
      )
      expect(runtime.waitForTerminal).not.toHaveBeenCalled()
      expect(captured.observeChat).not.toHaveBeenCalled()
      expect(captured.launch).not.toHaveBeenCalled()
    }
  )
  it('refuses an ambiguous crash without resending or marking success', async () => {
    const { rows } = fixture(false)
    rows.set(automationRunOperationId(run, 'fresh-launch'), { outcome: { status: 'unknown' } })
    const observer = captured.options.terminalObserver!
    expect(
      await observer.observeCompletion(observer.resolveRunTerminal(run)!, {
        run,
        signal: new AbortController().signal
      })
    ).toMatchObject({ status: 'dispatch_failed', error: expect.stringContaining('Claude') })
    expect(captured.launch).not.toHaveBeenCalled()
  })
})

function capturedOption<K extends keyof Options>(key: K): NonNullable<Options[K]> {
  const value = captured.options[key]
  if (value === undefined) {
    throw new Error(`the service was constructed without ${key}`)
  }
  return value
}

describe('desktop background dispatch authority', () => {
  it('keeps remote schedules on the server while dispatching local runs headlessly', () => {
    const runtime = { setAutomationService: vi.fn(), notifyAutomationsChanged: vi.fn() }
    const precheckMayContinue = () => true
    createRuntimeAutomationService({
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: construction reads only the settings that agent-spawn provenance binds.
      store: { getSettings: () => ({ chatSidebar: {} }) } as never,
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: construction invokes only these runtime methods.
      runtime: runtime as never,
      headless: false,
      dispatchHeadlessly: true,
      localSchedulePrecheckMayContinue: precheckMayContinue
    })

    expect(captured.options.headlessDispatcher).toBeTypeOf('function')
    expect(captured.options.allowRemoteHostScheduling).toBe(false)
    expect(captured.options.precheckMayContinue).toBe(precheckMayContinue)
  })
})

describe('headless automation dispatch', () => {
  it('hands the launched run to its watcher instead of awaiting one tui-idle wait itself', async () => {
    const updateSettings = vi.fn()
    const store = {
      listAutomations: () => [{ id: 'automation', executionTargetType: 'local', agentId: 'goose' }],
      listAutomationRuns: () => [],
      getSettings: () => ({ chatSidebar: {} }),
      updateSettings
    }
    const repo = {
      id: 'repo-1',
      path: '/repo',
      displayName: 'repo',
      badgeColor: 'blue',
      addedAt: 1
    }
    const managedWorktree = { id: 'wt-1', displayName: 'repo', hostId: 'local' as const }
    const runtime = {
      setAutomationService: vi.fn(),
      notifyAutomationsChanged: vi.fn(),
      launchAgentTerminal: vi.fn(async () => ({
        handle: 'terminal-1',
        tabId: 'tab-1',
        paneKey: 'tab-1:pane-1',
        ptyId: 'pty-1',
        worktreeId: 'wt-1'
      })),
      resolveManagedTerminalWorkspaceTarget: vi.fn(async () => ({
        managedWorktree,
        scope: { folderWorkspace: null }
      })),
      waitForTerminal: vi.fn(),
      getTerminalHandleForPaneKey: vi.fn(() => null),
      getAgentStatusRowsForPane: vi.fn(() => [])
    }
    createRuntimeAutomationService({
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the dispatcher reads only these mocked ownership methods.
      store: store as never,
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the dispatcher reads only the members faked above.
      runtime: runtime as never,
      headless: true
    })
    const dispatcher = capturedOption('headlessDispatcher')
    const launch = await dispatcher({
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a reuse-workspace automation; only these fields are read.
      automation: {
        workspaceMode: 'existing',
        workspaceId: 'wt-1',
        agentId: 'goose'
      } as never,
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: only the title and trigger are read.
      run: { id: 'run', automationId: 'automation', title: 'Nightly', trigger: 'scheduled' } as never,
      target: { ok: true, cwd: '/repo', repo }
    })

    expect(launch.completion).toBeUndefined()
    expect(launch.terminalPaneKey).toBe('tab-1:pane-1')
    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        chatSidebar: expect.objectContaining({
          automationChats: expect.arrayContaining(['["local","tab-1:pane-1"]'])
        })
      }),
      { notifyListeners: true }
    )
    expect(runtime.resolveManagedTerminalWorkspaceTarget).toHaveBeenCalledWith(
      'id:wt-1',
      'local',
      false
    )
    expect(runtime.launchAgentTerminal).toHaveBeenCalledWith(
      'id:wt-1',
      {
        agent: 'goose',
        prompt: '',
        title: 'Nightly',
        suppressStartupUpdatePrompt: true
      },
      { worktree: managedWorktree, repo, folderWorkspace: undefined }
    )
    expect(runtime.waitForTerminal).not.toHaveBeenCalled()
    const observer = capturedOption('terminalObserver')
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: resolution reads only the pane key.
    expect(observer.resolveRunTerminal({ terminalPaneKey: 'tab-1:pane-1' } as never)).toBe(
      'terminal-1'
    )
  })
})

describe.skipIf(process.platform !== 'win32')('local automation priority ownership', () => {
  it('checks the exact PTY and active run before each follow-up', async () => {
    priorityMocks.schedule.mockClear()
    let currentPtyId = 'pty-1'
    let runStatus = 'dispatched'
    const store = {
      listAutomations: () => [{ id: 'automation', executionTargetType: 'local', agentId: 'codex' }],
      listAutomationRuns: () => [{ id: 'run-1', status: runStatus }],
      getSettings: () => ({ chatSidebar: {} }),
      updateSettings: vi.fn()
    }
    const runtime = {
      setAutomationService: vi.fn(),
      notifyAutomationsChanged: vi.fn(),
      launchAgentTerminal: vi.fn(async () => ({
        handle: 'terminal-1',
        tabId: 'tab-1',
        paneKey: 'tab-1:pane-1',
        ptyId: 'pty-1',
        worktreeId: 'wt-1'
      })),
      showManagedWorktree: vi.fn(async () => ({ displayName: 'repo' })),
      resolveManagedTerminalWorkspaceTarget: vi.fn(async () => ({
        managedWorktree: { id: 'wt-1', displayName: 'repo', hostId: 'local' as const },
        scope: { folderWorkspace: null }
      })),
      getTerminalPtyIdForHandle: vi.fn(() => currentPtyId),
      getTerminalHandleForPaneKey: vi.fn(() => null),
      getAgentStatusRowsForPane: vi.fn(() => [])
    }
    createRuntimeAutomationService({
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: dispatcher reads only the mocked store methods.
      store: store as never,
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: dispatcher reads only the mocked runtime methods.
      runtime: runtime as never,
      headless: true
    })
    const dispatcher = capturedOption('headlessDispatcher')
    await dispatcher({
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: only these automation fields are read by the dispatcher.
      automation: {
        id: 'automation',
        workspaceMode: 'existing',
        workspaceId: 'wt-1',
        agentId: 'codex',
        executionTargetType: 'local'
      } as never,
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: only run identity and title are read by the dispatcher.
      run: { id: 'run-1', automationId: 'automation', title: 'Daily' } as never,
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: unused for an existing workspace.
      target: {} as never
    })

    expect(priorityMocks.schedule).toHaveBeenCalledTimes(1)
    const stillOwnsPty = priorityMocks.schedule.mock.calls[0]?.[1]
    expect(stillOwnsPty).toBeTypeOf('function')
    expect(stillOwnsPty()).toBe(true)
    runStatus = 'completed'
    expect(stillOwnsPty()).toBe(false)
    runStatus = 'dispatched'
    currentPtyId = 'pty-2'
    expect(stillOwnsPty()).toBe(false)
  })
})

describe('headless automation dispatch with extra agent args', () => {
  it('passes saved extras to an existing-workspace launch', async () => {
    const runtime = {
      setAutomationService: vi.fn(),
      notifyAutomationsChanged: vi.fn(),
      launchAgentTerminal: vi.fn(async () => ({
        handle: 'terminal-1',
        tabId: 'tab-1',
        paneKey: 'tab-1:pane-1',
        ptyId: 'pty-1',
        worktreeId: 'wt-1'
      })),
      showManagedWorktree: vi.fn(async () => ({ displayName: 'repo' })),
      resolveManagedTerminalWorkspaceTarget: vi.fn(async () => ({
        managedWorktree: { id: 'wt-1', displayName: 'repo', hostId: 'local' as const },
        scope: { folderWorkspace: null }
      })),
      getTerminalHandleForPaneKey: vi.fn(() => null),
      getAgentStatusRowsForPane: vi.fn(() => [])
    }
    createRuntimeAutomationService({
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: ownership exits before reading other store methods without a host.
      store: {
        getSettings: () => ({ chatSidebar: {} }),
        listAutomations: () => [],
        listAutomationRuns: () => []
      } as never,
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the dispatcher reads only the members faked above.
      runtime: runtime as never,
      headless: true
    })
    const dispatcher = capturedOption('headlessDispatcher')
    const automation = {
      workspaceMode: 'existing',
      workspaceId: 'wt-1',
      agentId: 'claude',
      prompt: 'go',
      extraAgentArgs: '--model opus'
    }
    await dispatcher({
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: only these fields are read.
      automation: automation as never,
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: only the title and trigger are read.
      run: { title: 'Nightly', trigger: 'scheduled' } as never,
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: unused for an existing workspace.
      target: {} as never
    })

    expect(runtime.launchAgentTerminal).toHaveBeenCalledWith(
      'id:wt-1',
      expect.objectContaining({
        agent: 'claude',
        prompt: 'go',
        title: 'Nightly',
        suppressStartupUpdatePrompt: true,
        extraAgentArgs: '--model opus'
      }),
      expect.anything()
    )
  })
})

describe('background automation session reuse', () => {
  it('sends a new prompt to the exact completed unused pane', async () => {
    const completed = {
      id: 'previous-run',
      workspaceId: 'wt-1',
      status: 'completed',
      createdAt: 1,
      terminalSessionId: 'tab-1',
      terminalPaneKey: 'tab-1:pane-1',
      terminalPtyId: 'pty-1'
    }
    const runtime = {
      setAutomationService: vi.fn(),
      notifyAutomationsChanged: vi.fn(),
      launchAgentTerminal: vi.fn(),
      showManagedWorktree: vi.fn(async () => ({ displayName: 'repo' })),
      resolveManagedTerminalWorkspaceTarget: vi.fn(async () => ({
        managedWorktree: { id: 'wt-1', displayName: 'repo', hostId: 'local' as const },
        scope: { folderWorkspace: null }
      })),
      getTerminalHandleForPaneKey: vi.fn(() => 'terminal-1'),
      getTerminalPtyIdForHandle: vi.fn(() => 'pty-1'),
      readTerminalClientUse: vi.fn(() => 'unused'),
      getAgentStatusRowsForPane: vi.fn(() => [
        { state: 'done', agentType: 'claude', receivedAt: 2 }
      ]),
      sendTerminalAgentPrompt: vi.fn(async () => ({ accepted: true }))
    }
    createRuntimeAutomationService({
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: this dispatch reads only listAutomationRuns.
      store: {
        getSettings: () => ({ chatSidebar: {} }),
        listAutomationRuns: () => [completed],
        listAutomations: () => []
      } as never,
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: only the mocked runtime methods above are invoked.
      runtime: runtime as never,
      headless: true
    })
    const dispatcher = capturedOption('headlessDispatcher')
    const result = await dispatcher({
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: reuse reads only these automation fields.
      automation: {
        id: 'automation-1',
        workspaceMode: 'existing',
        workspaceId: 'wt-1',
        agentId: 'claude',
        prompt: 'do the next task',
        reuseSession: true
      } as never,
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: reuse reads only the run id.
      run: { id: 'next-run', title: 'Nightly' } as never,
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: target is unused for existing workspaces.
      target: {} as never
    })

    expect(result).toMatchObject({
      terminalSessionId: 'tab-1',
      terminalPaneKey: 'tab-1:pane-1',
      terminalPtyId: 'pty-1'
    })
    expect(runtime.sendTerminalAgentPrompt).toHaveBeenCalledWith(
      'terminal-1',
      'do the next task',
      expect.objectContaining({ acceptQueued: true })
    )
    expect(runtime.launchAgentTerminal).not.toHaveBeenCalled()
  })
})
