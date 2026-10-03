[CmdletBinding(SupportsShouldProcess)]
param(
  [Parameter(Mandatory)][string] $Source,
  [string] $Target = "$env:LOCALAPPDATA\Programs\orca",
  [string] $UserData = "$env:APPDATA\orca",
  [string] $ExistingUserDataBackup = '',
  [scriptblock] $BeforeReplace,
  [scriptblock] $AfterReplace
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'install-reviewed-orca-backups.ps1')
. (Join-Path $PSScriptRoot 'install-reviewed-orca-transaction.ps1')
$sourcePath = (Resolve-Path -LiteralPath $Source).Path
$targetPath = (Resolve-Path -LiteralPath $Target).Path
$userDataPath = Get-ReviewedFullPath $UserData
if ($sourcePath -eq $targetPath -or $sourcePath.StartsWith("$targetPath\", [StringComparison]::OrdinalIgnoreCase) -or
  $targetPath.StartsWith("$sourcePath\", [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Source and installed app must be separate, non-nested directories.'
}
$manifest = Get-Content -LiteralPath (Join-Path $sourcePath 'reviewed-build.json') -Raw | ConvertFrom-Json
if ($manifest.smokeTest -ne 'passed') { throw 'The source package has no passing smoke-test record.' }

function Assert-ReviewedFiles([string] $Root) {
  foreach ($file in @(
    @{ Path = 'Orca.exe'; Hash = $manifest.exeSha256 },
    @{ Path = 'resources\app.asar'; Hash = $manifest.asarSha256 }
  )) {
    if (-not $file.Hash -or (Get-FileHash -LiteralPath (Join-Path $Root $file.Path) -Algorithm SHA256).Hash -ne $file.Hash) {
      throw "Reviewed package hash mismatch: $($file.Path)"
    }
  }
}

Assert-ReviewedFiles $sourcePath
if (-not (Test-Path -LiteralPath (Join-Path $targetPath 'Orca.exe'))) {
  throw "No installed Orca found at $targetPath."
}
# Why: Copy-Item silently skips a package folder where the app has a file, leaving a partial install.
foreach ($item in Get-ChildItem -LiteralPath $sourcePath -Recurse -Force) {
  $relative = $item.FullName.Substring($sourcePath.TrimEnd('\').Length).TrimStart('\')
  $existing = Get-Item -LiteralPath (Join-Path $targetPath $relative) -Force -ErrorAction SilentlyContinue
  if ($existing -and $existing.PSIsContainer -ne $item.PSIsContainer) {
    throw "Package item '$relative' would replace a $(if ($existing.PSIsContainer) { 'folder' } else { 'file' }) in the installed app. No files were changed."
  }
}
$targetExecutable = Join-Path $targetPath 'Orca.exe'
$desktopAppRunning = Get-Process -Name 'Orca' -ErrorAction SilentlyContinue | Where-Object {
  try {
    [string]::Equals($_.Path, $targetExecutable, [System.StringComparison]::OrdinalIgnoreCase)
  } catch {
    $false
  }
}
if (-not $WhatIfPreference -and $desktopAppRunning -and -not $BeforeReplace) {
  throw 'Close Orca completely before installing. No files were changed.'
}
if (-not $PSCmdlet.ShouldProcess($targetPath, 'Back up Orca and its user data, then install the smoke-tested build')) {
  return
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$backup = "$targetPath-backup-$stamp"
$stage = "$targetPath-stage-$stamp"
$stageCreated = $false
$backupCreated = $false
$recoveryFailed = $false
$userDataBackup = $null
try {
  Write-Host 'Preparing and verifying the complete update while the installed app remains untouched.'
  New-ReviewedAppStage $sourcePath $targetPath $stage ([ref]$stageCreated)
  Assert-ReviewedFiles $stage
  if ($BeforeReplace) { & $BeforeReplace }
  Assert-ReviewedDesktopClosed $targetExecutable
  if ($ExistingUserDataBackup) {
    $userDataBackup = (Resolve-Path -LiteralPath $ExistingUserDataBackup).Path
    if (-not [string]::Equals(
      (Split-Path -Parent $userDataBackup),
      (Split-Path -Parent $userDataPath),
      [System.StringComparison]::OrdinalIgnoreCase
    ) -or -not (Split-Path -Leaf $userDataBackup).StartsWith(
      "$(Split-Path -Leaf $userDataPath)-backup-",
      [System.StringComparison]::OrdinalIgnoreCase
    )) {
      throw 'Existing user data backup must be a sibling Orca backup directory.'
    }
  } elseif (Test-Path -LiteralPath $userDataPath) {
    $userDataBackup = "$userDataPath-backup-$stamp"
    New-ReviewedDataBackup $userDataPath $userDataBackup
  }
  # Why: the app may have reopened while the settings backup was being copied.
  Assert-ReviewedDesktopClosed $targetExecutable
  Switch-ReviewedAppStage $stage $targetPath $backup ([ref]$backupCreated)
  Assert-ReviewedFiles $targetPath
  Write-ReviewedBackupMarker $backup $targetPath 'app'
  if ($AfterReplace) { & $AfterReplace }
} catch {
  $installError = $_
  if ($backupCreated -and (Test-Path -LiteralPath $backup -PathType Container)) {
    try {
      if (Test-Path -LiteralPath $targetPath) { Move-ReviewedAppDirectory $targetPath $stage }
      Move-ReviewedAppDirectory $backup $targetPath
      $restoredMarker = Join-Path $targetPath '.orca-reviewed-backup.json'
      if (Test-Path -LiteralPath $restoredMarker) { Remove-Item -LiteralPath $restoredMarker -Force }
    } catch {
      $recoveryFailed = $true
      throw "Installation stopped. Complete app trees remain at $targetPath, $backup or $stage; do not launch until restored. Install error: $installError Restore error: $_"
    }
  }
  throw "Installation failed; the previous app files remain intact. Error: $installError"
} finally {
  if (-not $recoveryFailed -and $stageCreated -and (Test-Path -LiteralPath $stage) -and (Test-Path -LiteralPath $targetPath)) {
    try { Remove-ReviewedAppStage $stage $targetPath } catch {
      Write-Warning "Stage cleanup was deferred; the install outcome is unchanged. Preserved: $stage. Error: $_"
    }
  }
}
try {
  Remove-ExpiredReviewedBackups $targetPath 'app' @($backup)
  Remove-ExpiredReviewedBackups $userDataPath 'settings' @($userDataBackup)
} catch {
  Write-Warning "Installation passed, but old backup cleanup was deferred: $_"
}
Write-Host "Installed reviewed commit $($manifest.commit). App backup: $backup"
Write-Host "User data backup, if present: $userDataBackup"
