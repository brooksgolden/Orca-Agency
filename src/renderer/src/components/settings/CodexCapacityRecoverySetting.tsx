import { SettingsSwitchRow } from './SettingsFormControls'
import type { GlobalSettings } from '../../../../shared/global-settings-types'

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
        label="Retry Codex capacity errors"
        description="Automatically send Continue after temporary model capacity errors. Keeps your model, protects drafts, and retries at most three times in 15 minutes. Local terminals only."
        checked={settings.codexCapacityAutoContinue === true}
        onChange={() =>
          updateSettings({ codexCapacityAutoContinue: settings.codexCapacityAutoContinue !== true })
        }
        ariaLabel="Retry Codex capacity errors"
      />
    </section>
  )
}
