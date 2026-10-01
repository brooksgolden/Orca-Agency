<#
  Fixture test for install-reviewed-orca-fork.ps1 backup scope, retention and rollback.
  Builds a tiny fake package, app and data tree under -FixtureRoot and never touches real
  Orca folders. Throws on the first failed expectation.
#>
param([Parameter(Mandatory)][string] $FixtureRoot)

$ErrorActionPreference = 'Stop'
$installer = Join-Path $PSScriptRoot 'install-reviewed-orca-fork.ps1'
$root = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($FixtureRoot).TrimEnd('\')
foreach ($real in @($env:APPDATA, (Join-Path $env:LOCALAPPDATA 'Programs'))) {
  if ($real -and ($root -eq $real -or $root.StartsWith("$real\", [StringComparison]::OrdinalIgnoreCase))) {
    throw "Refusing to build a fixture inside $real."
  }
}
if ((Test-Path -LiteralPath $root) -and (Get-ChildItem -LiteralPath $root -Force | Select-Object -First 1)) {
  throw "Fixture root must be new or empty: $root"
}

$package = Join-Path $root 'package'
$programs = Join-Path $root 'Programs'
$roaming = Join-Path $root 'Roaming'
$target = Join-Path $programs 'orca'
$data = Join-Path $roaming 'orca'
$failures = 0

function New-FixtureFile([string] $Path, [string] $Content = 'x') {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Path) | Out-Null
  Set-Content -LiteralPath $Path -Value $Content -NoNewline -Encoding ASCII
}

function New-FixtureBackup([string] $Path, [string] $SourceRoot, [string] $Kind, [int] $Version = 2, [string] $Name = '') {
  New-FixtureFile (Join-Path $Path 'payload.txt') $Path
  if ($Kind) {
    @{
      owner = 'orca-reviewed-installer'; version = $Version; kind = $Kind; sourceRoot = $SourceRoot
      backup = $(if ($Name) { $Name } else { Split-Path -Leaf $Path }); createdAt = '2026-01-01T00:00:00Z'
    } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $Path '.orca-reviewed-backup.json') -Encoding UTF8
  }
}

function Get-TreeSignature([string] $Root) {
  (Get-ChildItem -LiteralPath $Root -Recurse -Force | Sort-Object FullName | ForEach-Object {
    $relative = $_.FullName.Substring($Root.Length)
    if ($_.PSIsContainer) { "D $relative" } else { "F $relative $((Get-FileHash -LiteralPath $_.FullName).Hash)" }
  }) -join "`n"
}

function Test-Expectation([bool] $Condition, [string] $Name) {
  if ($Condition) { Write-Host "PASS  $Name" } else { Write-Host "FAIL  $Name"; $script:failures++ }
}

function Invoke-FixtureInstall([hashtable] $Arguments) {
  $warnings = $null
  try {
    & $installer @Arguments -WarningVariable warnings -WarningAction SilentlyContinue | Out-Null
    return @{ Error = $null; Warnings = @($warnings) }
  } catch {
    return @{ Error = "$_"; Warnings = @($warnings) }
  }
}

function Get-BackupNames([string] $Parent) {
  @(Get-ChildItem -LiteralPath $Parent -Directory -Force | Where-Object Name -like 'orca-backup-*' |
    Select-Object -ExpandProperty Name | Sort-Object)
}

# Package, installed app and live data.
New-FixtureFile (Join-Path $package 'Orca.exe') 'new exe'
New-FixtureFile (Join-Path $package 'resources\app.asar') 'new asar'
New-FixtureFile (Join-Path $package 'resources\new-chunk.js') 'new chunk'
function Write-FixtureManifest {
  @{
    smokeTest = 'passed'; commit = 'fixture'
    exeSha256 = (Get-FileHash -LiteralPath (Join-Path $package 'Orca.exe')).Hash
    asarSha256 = (Get-FileHash -LiteralPath (Join-Path $package 'resources\app.asar')).Hash
  } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $package 'reviewed-build.json') -Encoding UTF8
}
Write-FixtureManifest
New-FixtureFile (Join-Path $target 'Orca.exe') 'old exe'
New-FixtureFile (Join-Path $target 'resources\app.asar') 'old asar'
New-FixtureFile (Join-Path $target 'keep.txt') 'user file beside the app'
New-FixtureFile (Join-Path $target 'conflict') 'a file the next package turns into a folder'

$kept = @(
  'orca-settings.json', 'auth\token.json', 'Local Storage\leveldb\000003.log',
  'codex-runtime-home\home\auth.json', 'codex-runtime-home\home\config.toml',
  'Partitions\persist_browser\Local Storage\leveldb\keep.ldb', 'Partitions\persist_browser\Preferences'
)
$excluded = @(
  'codex-runtime-home\home\sessions\2026\09\28\rollout-a.jsonl', 'codex-runtime-home\home\packages\p.bin',
  'codex-runtime-home\home\cache\c.bin', 'codex-runtime-home\home\tmp\t.bin', 'speech-models\m.bin',
  'Cache\Cache_Data\data_0', 'Code Cache\js\index', 'GPUCache\data_1', 'DawnGraphiteCache\data_2',
  'DawnWebGPUCache\data_3', 'GrShaderCache\data_4', 'Partitions\persist_browser\Cache\Cache_Data\data_0',
  'Partitions\persist_browser\Code Cache\js\index', 'Partitions\persist_browser\GPUCache\data_1', 'Cookies'
)
foreach ($file in $kept + $excluded) { New-FixtureFile (Join-Path $data $file) $file }
# Left behind by a manual restore from an older backup; must not seed new backups.
New-FixtureFile (Join-Path $data '.orca-reviewed-backup.json') '{"owner":"orca-reviewed-installer"}'
New-FixtureFile (Join-Path $data 'backup-scope.json') '{}'

# Existing app backups: 3 managed, plus lookalikes that must never be deleted.
foreach ($day in '01', '02', '03') { New-FixtureBackup (Join-Path $programs "orca-backup-202601$day-000000-001") $target 'app' }
New-FixtureBackup (Join-Path $programs 'orca-backup-20250101-000000-001') $target ''
New-FixtureBackup (Join-Path $programs 'orca-backup-20250102-000000-001') $target 'app' 1
New-FixtureBackup (Join-Path $programs 'orca-backup-20250103-000000-001') $target 'app' 2 'orca-backup-20260101-000000-001'
New-FixtureBackup (Join-Path $programs 'orca-backup-20250104-000000-001') $target 'settings'
New-FixtureBackup (Join-Path $programs 'orca-backup-20250105-000000-001') $target 'app'
New-FixtureFile (Join-Path $root 'link-target\sentinel.txt') 'must survive'
New-Item -ItemType Junction -Path (Join-Path $programs 'orca-backup-20250105-000000-001\linked') -Target (Join-Path $root 'link-target') | Out-Null
New-FixtureBackup (Join-Path $programs 'otherapp-backup-20250101-000000-001') (Join-Path $programs 'otherapp') 'app'
# Existing settings backups: 3 managed and 1 legacy.
foreach ($day in '01', '02', '03') { New-FixtureBackup (Join-Path $roaming "orca-backup-202601$day-000000-001") $data 'settings' }
New-FixtureBackup (Join-Path $roaming 'orca-backup-20240101-000000-001') $data ''

$common = @{ Source = $package; Target = $target; UserData = $data }

# 1. WhatIf changes nothing.
$before = Get-TreeSignature $root
$result = Invoke-FixtureInstall ($common + @{ WhatIf = $true })
Test-Expectation (-not $result.Error -and (Get-TreeSignature $root) -eq $before) 'WhatIf leaves every fixture file untouched'

# 2. Successful install: backup scope, live data preserved, retention.
$liveBefore = Get-TreeSignature $data
$result = Invoke-FixtureInstall $common
Test-Expectation (-not $result.Error) "install succeeds ($($result.Error))"
Test-Expectation ($global:LASTEXITCODE -eq 0) 'a successful install leaves no nonzero robocopy exit code behind'
Test-Expectation ((Get-Content -LiteralPath (Join-Path $target 'Orca.exe') -Raw) -eq 'new exe') 'installed app has the reviewed files'
Test-Expectation ((Get-TreeSignature $data) -eq $liveBefore) 'live data, including transcripts and caches, is unchanged'
$newSettings = Get-BackupNames $roaming | Where-Object { $_ -gt 'orca-backup-2026010' } | Select-Object -Last 1
$settingsBackup = Join-Path $roaming $newSettings
Test-Expectation (@($kept | Where-Object { -not (Test-Path -LiteralPath (Join-Path $settingsBackup $_)) }).Count -eq 0) 'settings backup keeps auth, config and profile data'
Test-Expectation (@($excluded | Where-Object { Test-Path -LiteralPath (Join-Path $settingsBackup $_) }).Count -eq 0) 'settings backup skips transcripts, model/package caches and browser caches, including partitions'
$marker = Get-Content -LiteralPath (Join-Path $settingsBackup '.orca-reviewed-backup.json') -Raw | ConvertFrom-Json
Test-Expectation ($marker.backup -eq $newSettings -and $marker.kind -eq 'settings' -and $marker.sourceRoot -eq $data) 'settings marker names its own folder, kind and source'
Test-Expectation (Test-Path -LiteralPath (Join-Path $settingsBackup 'backup-scope.json')) 'settings backup records what it skipped'
$appNames = Get-BackupNames $programs
$newApp = $appNames | Where-Object { $_ -gt 'orca-backup-2026010' } | Select-Object -Last 1
Test-Expectation (-not ($appNames -contains 'orca-backup-20260101-000000-001') -and -not ($appNames -contains 'orca-backup-20260102-000000-001')) 'expired managed app backups are deleted'
Test-Expectation ($appNames -contains 'orca-backup-20260103-000000-001' -and $newApp) 'the newest 2 app backups, including this install, remain'
foreach ($name in 'orca-backup-20250101-000000-001', 'orca-backup-20250102-000000-001', 'orca-backup-20250103-000000-001', 'orca-backup-20250104-000000-001') {
  Test-Expectation ($appNames -contains $name) "lookalike backup is never deleted: $name"
}
Test-Expectation ($appNames -contains 'orca-backup-20250105-000000-001' -and (Test-Path -LiteralPath (Join-Path $root 'link-target\sentinel.txt'))) 'a backup holding a link is preserved and its link target survives'
Test-Expectation (@($result.Warnings | Where-Object { "$_" -like '*link*' }).Count -eq 1) 'the preserved linked backup is reported'
Test-Expectation (Test-Path -LiteralPath (Join-Path $programs 'otherapp-backup-20250101-000000-001')) 'another app backup is untouched'
$settingsNames = Get-BackupNames $roaming
Test-Expectation (-not ($settingsNames -contains 'orca-backup-20260101-000000-001') -and ($settingsNames -contains 'orca-backup-20260103-000000-001') -and ($settingsNames -contains 'orca-backup-20240101-000000-001')) 'settings retention keeps 2 managed backups and the legacy one'

# 3. A backup handed to this install survives retention, with relative paths.
foreach ($day in '04', '05') { New-FixtureBackup (Join-Path $roaming "orca-backup-202601$day-000000-001") $data 'settings' }
Push-Location $root
try {
  $result = Invoke-FixtureInstall @{
    Source = 'package'; Target = 'Programs\orca'; UserData = 'Roaming\orca'
    ExistingUserDataBackup = 'Roaming\orca-backup-20260103-000000-001'
  }
} finally { Pop-Location }
Test-Expectation (-not $result.Error) "install with a given settings backup and relative paths succeeds ($($result.Error))"
Test-Expectation (Test-Path -LiteralPath (Join-Path $roaming 'orca-backup-20260103-000000-001')) 'the settings backup given to this install is never deleted'
Test-Expectation (-not (Test-Path -LiteralPath (Join-Path $roaming 'orca-backup-20260104-000000-001'))) 'older unprotected settings backups still expire'
Test-Expectation (Test-Path -LiteralPath (Join-Path $roaming $newSettings)) 'the newest settings backup remains'

# 4. A failed install restores the app exactly, without the backup marker or added files.
New-FixtureFile (Join-Path $package 'aaa-added\new.dll') 'added by the failed package'
New-FixtureFile (Join-Path $package 'Orca.exe') 'newer exe'
New-FixtureFile (Join-Path $package 'zzz-unreadable.bin') 'copy fails here, after earlier files landed'
Write-FixtureManifest
$appBefore = Get-TreeSignature $target
# Why an exclusive handle on a package-only file: the install fails mid-copy, yet every app file stays writable for the restore.
$lock = [IO.File]::Open((Join-Path $package 'zzz-unreadable.bin'), 'Open', 'Read', 'None')
try { $result = Invoke-FixtureInstall $common } finally { $lock.Dispose() }
Test-Expectation ($result.Error -like '*previous app files remain intact*') "failed staging reports an intact original app ($($result.Error))"
Test-Expectation ((Get-TreeSignature $target) -eq $appBefore) 'rollback leaves the app exactly as before, with no marker or added files'

# 5. An interrupted delete keeps its marker, so a later install finishes it instead of orphaning it.
Remove-Item -LiteralPath (Join-Path $package 'zzz-unreadable.bin') -Force
Write-FixtureManifest
$stuck = Join-Path $programs 'orca-backup-20240101-000000-001'
New-FixtureBackup $stuck $target 'app'
New-FixtureFile (Join-Path $stuck 'z-in-use.bin') 'held open'
$lock = [IO.File]::Open((Join-Path $stuck 'z-in-use.bin'), 'Open', 'Read', 'None')
try { $result = Invoke-FixtureInstall $common } finally { $lock.Dispose() }
Test-Expectation (-not $result.Error -and @($result.Warnings | Where-Object { "$_" -like '*cleanup was deferred*' }).Count -eq 1) 'a blocked delete defers cleanup without failing the install'
Test-Expectation (Test-Path -LiteralPath (Join-Path $stuck '.orca-reviewed-backup.json')) 'the partly deleted backup is still marked'
$result = Invoke-FixtureInstall $common
Test-Expectation (-not $result.Error -and -not (Test-Path -LiteralPath $stuck)) 'the next install finishes the deferred delete'

# 6. A package folder where the app has a file is refused before anything changes.
New-FixtureFile (Join-Path $package 'conflict\inner.txt') 'a folder where the app has a file'
$before = Get-TreeSignature $root
$result = Invoke-FixtureInstall $common
Test-Expectation ($result.Error -like "*'conflict' would replace a file*No files were changed*" -and (Get-TreeSignature $root) -eq $before) 'a file/folder clash is refused with nothing changed'
Remove-Item -LiteralPath (Join-Path $package 'conflict') -Recurse -Force

# 7. Encoded terminal-history paths exceed MAX_PATH in real Orca backups.
. (Join-Path $PSScriptRoot 'install-reviewed-orca-backups.ps1')
. (Join-Path $PSScriptRoot 'install-reviewed-orca-transaction.ps1')
$longBackup = Join-Path $programs 'orca-backup-20230101-000000-001'
New-FixtureBackup $longBackup $target 'app'
$longDirectory = Join-Path $longBackup ('terminal-history\' + ('encoded-workspace-' * 9))
$nativeDirectory = Get-ReviewedNativePath $longDirectory
[IO.Directory]::CreateDirectory($nativeDirectory) | Out-Null
[IO.File]::WriteAllText([IO.Path]::Combine($nativeDirectory, 'screen.bin'), 'obsolete screen buffer')
Test-Expectation ((Join-Path $longDirectory 'screen.bin').Length -gt 260) 'long-path fixture exceeds the normal Windows path limit'
Remove-ExpiredReviewedBackups $target 'app'
Test-Expectation (-not (Test-Path -LiteralPath $longBackup)) 'retention deletes obsolete backups containing long encoded workspace paths'
Test-Expectation (Test-Path -LiteralPath (Join-Path $root 'link-target\sentinel.txt')) 'long-path cleanup still preserves linked targets'

# 8. A late app/file lock cannot leave a partially overwritten installation.
$appBefore = Get-TreeSignature $target
$lockHolder = @{ Handle = $null }
try {
  $result = Invoke-FixtureInstall ($common + @{ BeforeReplace = {
    $lockHolder.Handle = [IO.File]::Open((Join-Path $target 'resources\app.asar'), 'Open', 'Read', 'None')
  } })
} finally { if ($lockHolder.Handle) { $lockHolder.Handle.Dispose() } }
Test-Expectation ($result.Error -like '*previous app files remain intact*' -and
  (Get-TreeSignature $target) -eq $appBefore -and
  -not (Get-ChildItem -LiteralPath $programs -Directory | Where-Object Name -like 'orca-stage-*')) 'a late lock leaves a complete app and no staging copy'

# 9. Failed directory promotion restores the old tree by rename.
$missingStage = "$target-stage-20260101-000000-001"
$promotionBackup = "$target-backup-20260101-000000-002"
$originalMoved = $false
try { Switch-ReviewedAppStage $missingStage $target $promotionBackup ([ref]$originalMoved) } catch { $promotionError = $_ }
Test-Expectation ($originalMoved -and $promotionError.Exception.InnerException -is [IO.DirectoryNotFoundException] -and
  (Get-TreeSignature $target) -eq $appBefore -and -not (Test-Path -LiteralPath $promotionBackup)) 'failed promotion really moves and restores the complete previous app'

# 10. A shutdown timeout aborts after staging, before any installed file changes.
$callbackState = @{ Invoked = $false; OriginalIntact = $false }
$result = Invoke-FixtureInstall ($common + @{ BeforeReplace = {
  $callbackState.Invoked = $true
  $callbackState.OriginalIntact = (Get-TreeSignature $target) -eq $appBefore
  throw 'Fixture desktop did not close'
} })
Test-Expectation ($callbackState.Invoked -and $callbackState.OriginalIntact -and $result.Error -like '*Fixture desktop did not close*') 'shutdown runs only after preparation, with the original app intact'
Test-Expectation ((Get-TreeSignature $target) -eq $appBefore -and -not (Get-ChildItem -LiteralPath $programs -Directory | Where-Object Name -like 'orca-stage-*')) 'shutdown failure leaves the installed app unchanged and removes its staging copy'

# 11. Another directory appearing at the chosen backup path does not become ours to restore.
$collision = @{ Path = '' }
$result = Invoke-FixtureInstall ($common + @{ BeforeReplace = {
  $collision.Path = $backup
  New-FixtureFile (Join-Path $collision.Path 'foreign.txt') 'preserve this directory'
} })
Test-Expectation ($result.Error -like '*backup must be a new sibling*' -and
  (Get-TreeSignature $target) -eq $appBefore -and
  (Test-Path -LiteralPath (Join-Path $collision.Path 'foreign.txt'))) 'a backup-name collision preserves both the installed app and the unrelated directory'

# 12. A locked staged file permits the first rename but blocks promotion and cleanup.
$stageLock = @{ Handle = $null; Path = ''; Backup = '' }
try {
  $result = Invoke-FixtureInstall ($common + @{ BeforeReplace = {
    $stageLock.Path = $stage
    $stageLock.Backup = $backup
    $stageLock.Handle = [IO.File]::Open((Join-Path $stage 'resources\app.asar'), 'Open', 'Read', 'None')
  } })
} finally { if ($stageLock.Handle) { $stageLock.Handle.Dispose() } }
Test-Expectation ($result.Error -like '*previous app files remain intact*' -and
  (Get-TreeSignature $target) -eq $appBefore -and -not (Test-Path -LiteralPath $stageLock.Backup)) 'a locked stage restores the moved original app'
Test-Expectation (@($result.Warnings | Where-Object { "$_" -like '*Stage cleanup was deferred*' }).Count -eq 1) 'locked-stage cleanup preserves the original failure message and reports its path'
Remove-ReviewedAppStage $stageLock.Path $target
Test-Expectation (-not (Test-Path -LiteralPath $stageLock.Path)) 'the retained stage can be cleaned after its file lock is released'

# 13. Windows can retain a short-lived file lock after the desktop exits.
Add-Type -TypeDefinition @'
public static class OrcaFixtureDelayedUnlock {
  public static void Release(System.IDisposable handle) {
    System.Threading.ThreadPool.QueueUserWorkItem(_ => {
      System.Threading.Thread.Sleep(800);
      handle.Dispose();
    });
  }
}
'@
$retryStage = "$target-stage-20260101-000000-013"
$retryBackup = "$target-backup-20260101-000000-013"
$retryStageCreated = $false
New-ReviewedAppStage $package $target $retryStage ([ref]$retryStageCreated)
New-FixtureFile (Join-Path $retryStage 'retry-proof.txt') 'new staged tree'
$transientHandle = [IO.File]::Open((Join-Path $target 'resources\app.asar'), 'Open', 'Read', 'None')
$lockBlockedMove = $false
$retryOriginalMoved = $false
try {
  try { [IO.Directory]::Move($target, $retryBackup) } catch { $lockBlockedMove = $true }
  Test-Expectation $lockBlockedMove 'the transient-lock fixture actually blocks an immediate directory move'
  [OrcaFixtureDelayedUnlock]::Release($transientHandle)
  Switch-ReviewedAppStage $retryStage $target $retryBackup ([ref]$retryOriginalMoved)
} finally { $transientHandle.Dispose() }
Test-Expectation ($retryOriginalMoved -and (Test-Path -LiteralPath (Join-Path $target 'retry-proof.txt')) -and
  (Get-TreeSignature $retryBackup) -eq $appBefore) 'a transient lock is retried, promoting the stage and retaining the complete previous tree'

Write-Host ''
if ($failures) { throw "$failures installer expectation(s) failed." }
Write-Host 'All installer backup expectations passed.'
