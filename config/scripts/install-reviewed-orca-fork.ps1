[CmdletBinding(SupportsShouldProcess)]
param(
  [Parameter(Mandatory)][string] $Source,
  [string] $Target = "$env:LOCALAPPDATA\Programs\orca",
  [string] $UserData = "$env:APPDATA\orca",
  [string] $ExistingUserDataBackup = ''
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'install-reviewed-orca-backups.ps1')
$sourcePath = (Resolve-Path -LiteralPath $Source).Path
$targetPath = (Resolve-Path -LiteralPath $Target).Path
$userDataPath = Get-ReviewedFullPath $UserData
if ($sourcePath -eq $targetPath) { throw 'Source and installed app must be different directories.' }
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
if (-not $WhatIfPreference -and $desktopAppRunning) {
  throw 'Close Orca completely before installing. No files were changed.'
}
if (-not $PSCmdlet.ShouldProcess($targetPath, 'Back up Orca and its user data, then install the smoke-tested build')) {
  return
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$backup = "$targetPath-backup-$stamp"
Copy-Item -LiteralPath $targetPath -Destination $backup -Recurse
Write-ReviewedBackupMarker $backup $targetPath 'app'
$userDataBackup = $null
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
try {
  foreach ($entry in Get-ChildItem -LiteralPath $sourcePath -Force) {
    Copy-Item -LiteralPath $entry.FullName -Destination $targetPath -Recurse -Force
  }
  Assert-ReviewedFiles $targetPath
} catch {
  $installError = $_
  try {
    Restore-ReviewedAppBackup $backup $targetPath $sourcePath
  } catch {
    throw "Installation failed and the automatic restore also failed. Restore the app manually from $backup. Install error: $installError Restore error: $_"
  }
  throw "Installation failed; the previous app files were restored. Backup: $backup. Error: $installError"
}
try {
  Remove-ExpiredReviewedBackups $targetPath 'app' @($backup)
  Remove-ExpiredReviewedBackups $userDataPath 'settings' @($userDataBackup)
} catch {
  Write-Warning "Installation passed, but old backup cleanup was deferred: $_"
}
Write-Host "Installed reviewed commit $($manifest.commit). App backup: $backup"
Write-Host "User data backup, if present: $userDataBackup"
