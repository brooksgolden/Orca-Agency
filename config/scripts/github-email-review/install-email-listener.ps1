$ErrorActionPreference = 'Stop'
$configPath = Join-Path $PSScriptRoot 'config.json'
$config = Get-Content -Raw -LiteralPath $configPath | ConvertFrom-Json
$automation = & $config.orcaExecutable automations show $config.automationId --json | ConvertFrom-Json
if (-not $automation.ok -or $automation.result.automation.enabled) {
    throw 'A matching Orca automation with its schedule disabled is required.'
}
$pythonWindowless = 'C:\Python314\pythonw.exe'
if (-not (Test-Path -LiteralPath $pythonWindowless)) { throw 'The documented Python runtime is missing.' }
$bridgePath = Join-Path $PSScriptRoot 'email-bridge.py'
$taskName = 'OrcaAgencyGitHubEmailListener'
$taskUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$action = New-ScheduledTaskAction -Execute $pythonWindowless -Argument ('"' + $bridgePath + '" listen') -WorkingDirectory $PSScriptRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $taskUser
$principal = New-ScheduledTaskPrincipal -UserId $taskUser -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing) {
    if ($existing.Actions.Execute -ne $pythonWindowless -or $existing.Actions.Arguments -ne $action.Arguments) {
        throw 'An existing listener task has a different action; preserve it for inspection.'
    }
} else {
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description ('Email webhook listener for Orca automation ' + $config.automationId + '. No periodic mailbox or GitHub checks.') | Out-Null
}
Start-ScheduledTask -TaskName $taskName
Get-ScheduledTask -TaskName $taskName | Select-Object TaskName, State, Triggers
