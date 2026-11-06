import { describe, expect, it } from 'vitest'
import type {
  ExternalAutomationManager,
  ExternalAutomationRun
} from '../../../../shared/automations-types'
import {
  getExternalProviderLabel,
  getExternalRunStatusLabel,
  getExternalRunStatusVariant
} from './external-automation-display'

function manager(provider: 'hermes' | 'openclaw'): ExternalAutomationManager {
  return {
    id: `${provider}:local`,
    provider,
    label: provider,
    targetLabel: 'This computer',
    target: { type: 'local' },
    status: 'available',
    error: null,
    canManage: true,
    jobs: []
  }
}

function run(status: ExternalAutomationRun['status']): ExternalAutomationRun {
  return {
    id: 'run-1',
    managerId: 'hermes:local',
    provider: 'hermes',
    jobId: 'job-1',
    runAt: null,
    status,
    outputPreview: null,
    outputContent: null,
    error: null,
    outputPath: null
  }
}

describe('external automation display', () => {
  it('labels Hermes and OpenClaw by their actual provider', () => {
    expect(getExternalProviderLabel(manager('hermes'))).toBe('Hermes')
    expect(getExternalProviderLabel(manager('openclaw'))).toBe('OpenClaw')
  })

  it.each([
    ['completed', 'Completed', 'secondary'],
    ['failed', 'Failed', 'destructive'],
    ['unknown', 'Unknown', 'outline']
  ] as const)('maps %s run status to its label and badge', (status, label, variant) => {
    const value = run(status)
    expect(getExternalRunStatusLabel(value)).toBe(label)
    expect(getExternalRunStatusVariant(value)).toBe(variant)
  })
})
