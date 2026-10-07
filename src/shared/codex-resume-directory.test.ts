import { describe, expect, it } from 'vitest'
import { buildAgentResumeStartupPlan } from './tui-agent-resume-startup'

describe('Codex resume directory choice', () => {
  it.each(['powershell', 'posix', 'cmd'] as const)('uses the selected workspace on %s', (shell) => {
    const plan = buildAgentResumeStartupPlan({
      agent: 'codex',
      providerSession: { key: 'session_id', id: 'exact-session' },
      cmdOverrides: {},
      platform: shell === 'posix' ? 'linux' : 'win32',
      shell
    })
    expect(plan?.launchCommand).toBe(
      shell === 'cmd'
        ? 'codex "--cd" "." "resume" "exact-session"'
        : "codex '--cd' '.' 'resume' 'exact-session'"
    )
    expect(plan?.launchConfig.agentCommand).toBe('codex')
  })

  it.each([
    'codex --cd /explicit',
    'codex --cd=/explicit',
    'codex -C /explicit',
    'codex -C/explicit'
  ])('preserves the explicit directory in %s', (agentCommand) => {
    const plan = buildAgentResumeStartupPlan({
      agent: 'codex',
      providerSession: { key: 'session_id', id: 'exact-session' },
      cmdOverrides: {},
      agentCommand,
      platform: 'linux'
    })
    expect(plan?.launchCommand).toBe(`${agentCommand} 'resume' 'exact-session'`)
  })
})
