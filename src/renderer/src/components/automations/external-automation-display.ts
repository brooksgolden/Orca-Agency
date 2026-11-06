import type React from 'react'
import type { Badge } from '@/components/ui/badge'
import type {
  ExternalAutomationManager,
  ExternalAutomationRun
} from '../../../../shared/automations-types'
import { translate } from '@/i18n/i18n'
import {
  formatAutomationDateTime,
  formatAutomationDateTimeWithRelative
} from './automation-page-parts'

export function formatExternalDate(value: string | null, now: number): string {
  if (!value) {
    return formatAutomationDateTime(null)
  }
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) {
    return value
  }
  return formatAutomationDateTimeWithRelative(parsed, now)
}

export function getExternalProviderLabel(manager: ExternalAutomationManager): string {
  return manager.provider === 'hermes' ? 'Hermes' : 'OpenClaw'
}

export function getExternalTargetKindLabel(manager: ExternalAutomationManager): string {
  return manager.target.type === 'ssh'
    ? translate('auto.components.automations.externalDisplay.sshHost', 'SSH host')
    : translate('auto.components.automations.externalDisplay.local', 'Local')
}

export function getExternalRunStatusLabel(run: ExternalAutomationRun): string {
  switch (run.status) {
    case 'completed':
      return 'Completed'
    case 'failed':
      return 'Failed'
    case 'unknown':
      return 'Unknown'
  }
}

export function getExternalRunStatusVariant(
  run: ExternalAutomationRun
): React.ComponentProps<typeof Badge>['variant'] {
  switch (run.status) {
    case 'completed':
      return 'secondary'
    case 'failed':
      return 'destructive'
    case 'unknown':
      return 'outline'
  }
}
