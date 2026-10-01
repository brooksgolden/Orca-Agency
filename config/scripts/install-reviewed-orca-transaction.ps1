$ErrorActionPreference = 'Stop'

function Assert-ReviewedDesktopClosed([string] $Executable) {
  $running = @(Get-Process -Name Orca -ErrorAction SilentlyContinue | Where-Object {
    try { [string]::Equals($_.Path, $Executable, [StringComparison]::OrdinalIgnoreCase) } catch { $false }
  })
  if ($running.Count) { throw 'Orca reopened or is still running. Installed app files were not changed.' }
}

function Assert-ReviewedStagePath([string] $Stage, [string] $Target) {
  $stagePath = Get-ReviewedFullPath $Stage
  $targetPath = Get-ReviewedFullPath $Target
  $pattern = '^' + [regex]::Escape((Split-Path -Leaf $targetPath)) + '-stage-\d{8}-\d{6}-\d{3}$'
  if ((Split-Path -Parent $stagePath) -ne (Split-Path -Parent $targetPath) -or
    (Split-Path -Leaf $stagePath) -notmatch $pattern) { throw 'Staging directory is outside the installation parent.' }
  foreach ($root in @($stagePath, $targetPath)) {
    if (Test-Path -LiteralPath $root) {
      if ((Get-Item -LiteralPath $root -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw 'App transaction roots must not be directory links.'
      }
    }
  }
}

function New-ReviewedAppStage([string] $Source, [string] $Target, [string] $Stage, [ref] $Created) {
  Assert-ReviewedStagePath $Stage $Target
  if (Test-Path -LiteralPath $Stage) { throw 'Staging directory already exists.' }
  foreach ($root in @($Source, $Target)) {
    if (Get-ChildItem -LiteralPath $root -Recurse -Force | Where-Object {
      $_.Attributes -band [IO.FileAttributes]::ReparsePoint
    } | Select-Object -First 1) { throw 'App trees containing links cannot be staged.' }
  }
  # Why: preserve the existing uninstaller and app-adjacent files without overwriting live binaries.
  New-Item -ItemType Directory -Path $Stage -ErrorAction Stop | Out-Null
  $Created.Value = $true
  foreach ($entry in Get-ChildItem -LiteralPath $Target -Force) {
    Copy-Item -LiteralPath $entry.FullName -Destination $Stage -Recurse
  }
  foreach ($entry in Get-ChildItem -LiteralPath $Source -Force) {
    Copy-Item -LiteralPath $entry.FullName -Destination $Stage -Recurse -Force
  }
  foreach ($file in Get-ChildItem -LiteralPath $Source -Recurse -File -Force) {
    $relative = $file.FullName.Substring($Source.TrimEnd('\').Length).TrimStart('\')
    if ((Get-FileHash -LiteralPath $file.FullName).Hash -ne
      (Get-FileHash -LiteralPath (Join-Path $Stage $relative)).Hash) {
      throw "Staged file verification failed: $relative"
    }
  }
}

function Switch-ReviewedAppStage([string] $Stage, [string] $Target, [string] $Backup, [ref] $OriginalMoved = $null) {
  Assert-ReviewedStagePath $Stage $Target
  $backupPath = Get-ReviewedFullPath $Backup
  $pattern = '^' + [regex]::Escape((Split-Path -Leaf $Target)) + '-backup-\d{8}-\d{6}-\d{3}$'
  if ((Split-Path -Parent $backupPath) -ne (Split-Path -Parent $Target) -or
    (Split-Path -Leaf $backupPath) -notmatch $pattern -or (Test-Path -LiteralPath $backupPath)) {
    throw 'App backup must be a new sibling directory.'
  }
  # Why: each path always contains a complete app; never overwrite mapped files one by one.
  Move-ReviewedAppDirectory $Target $backupPath
  if ($OriginalMoved) { $OriginalMoved.Value = $true }
  try { Move-ReviewedAppDirectory $Stage $Target } catch {
    Move-ReviewedAppDirectory $backupPath $Target
    throw
  }
}

function Move-ReviewedAppDirectory([string] $Source, [string] $Destination) {
  for ($attempt = 0; $attempt -lt 10; $attempt++) {
    try { [IO.Directory]::Move($Source, $Destination); return } catch {
      if ($attempt -eq 9) { throw }
      Start-Sleep -Milliseconds 500
    }
  }
}

function Remove-ReviewedAppStage([string] $Stage, [string] $Target) {
  Assert-ReviewedStagePath $Stage $Target
  if (-not (Test-Path -LiteralPath $Stage)) { return }
  if (Get-ChildItem -LiteralPath $Stage -Recurse -Force | Where-Object {
    $_.Attributes -band [IO.FileAttributes]::ReparsePoint
  } | Select-Object -First 1) { throw 'Preserving staging directory containing a link.' }
  Remove-Item -LiteralPath $Stage -Recurse -Force
}
