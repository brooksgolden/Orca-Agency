[CmdletBinding()]
param([Parameter(Mandatory)][string]$TestDirectory)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'invoke-reviewed-codex-log.ps1')
New-Item -ItemType Directory -Path $TestDirectory -Force | Out-Null
$native = Join-Path $PSHOME 'powershell.exe'
$log = Join-Path $TestDirectory 'stdout.jsonl'
$errorLog = Join-Path $TestDirectory 'stderr.log'
$scriptPath = Join-Path $TestDirectory 'warning-fixture.ps1'
[IO.File]::WriteAllText($scriptPath, '[Console]::Error.WriteLine("warning fixture"); [Console]::Out.WriteLine("completed"); exit 0')
Invoke-ReviewedCodexLog -Executable $native -Arguments @('-NoProfile', '-File', $scriptPath) -PromptText 'fixture' -Log $log -ErrorLog $errorLog
if ((Get-Content -LiteralPath $log -Raw).Trim() -ne 'completed') { throw 'stdout was lost or contaminated.' }
if ((Get-Content -LiteralPath $errorLog -Raw) -notmatch 'warning fixture') { throw 'stderr was not retained.' }
if ($ErrorActionPreference -ne 'Stop') { throw 'Error preference leaked.' }
[IO.File]::WriteAllText($scriptPath, '[Console]::Error.WriteLine("failure fixture"); exit 7')
$failed = $false
try {
    Invoke-ReviewedCodexLog -Executable $native -Arguments @('-NoProfile', '-File', $scriptPath) -PromptText 'fixture' -Log $log -ErrorLog $errorLog
} catch {
    if ($_.Exception.Message -notmatch 'exit code 7') { throw }
    $failed = $true
}
if (-not $failed) { throw 'Native failure was accepted.' }
if ($ErrorActionPreference -ne 'Stop') { throw 'Error preference leaked after failure.' }
'Passed: stderr warning survives, stdout stays separate, nonzero exit fails, preferences restore on both paths.'
