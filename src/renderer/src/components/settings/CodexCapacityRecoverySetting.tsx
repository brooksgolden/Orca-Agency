import { SettingsSwitchRow } from './SettingsFormControls'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { translate } from '@/i18n/i18n'

export function CodexCapacityRecoverySetting({
  settings,
  updateSettings
}: {
  settings: GlobalSettings
  updateSettings: (patch: Partial<GlobalSettings>) => void
}) {
  return (
    <section className="space-y-3">
      <SettingsSwitchRow
        label={translate(
          'auto.components.settings.CodexCapacityRecoverySetting.label',
          'Retry interrupted Codex turns'
        )}
        description={translate(
          'auto.components.settings.CodexCapacityRecoverySetting.description',
          'Retry model capacity errors and the exact generic Bad Request error. Keeps your model, protects drafts and paused goals, and retries at most three times in 15 minutes. Local terminals only.'
        )}
        checked={settings.codexCapacityAutoContinue === true}
        onChange={() =>
          updateSettings({ codexCapacityAutoContinue: settings.codexCapacityAutoContinue !== true })
        }
        ariaLabel={translate(
          'auto.components.settings.CodexCapacityRecoverySetting.ariaLabel',
          'Retry interrupted Codex turns'
        )}
      />
    </section>
  )
}
