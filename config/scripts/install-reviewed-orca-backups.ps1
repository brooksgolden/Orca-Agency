$ErrorActionPreference = 'Stop'
$script:ReviewedBackupMarker = '.orca-reviewed-backup.json'
$script:ReviewedBackupScope = 'backup-scope.json'
$script:ReviewedBackupRetain = 2

function Get-ReviewedFullPath([string] $Path) {
  # Why: .NET resolves relative paths against the process directory, not the PowerShell location.
  $full = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Path)
  if ($full -match '^[A-Za-z]:\\$') { return $full }
  return $full.TrimEnd('\')
}

function Write-ReviewedBackupMarker([string] $Backup, [string] $SourceRoot, [string] $Kind) {
  @{
    owner = 'orca-reviewed-installer'
    version = 2
    # Why: a marker copied into another folder (a manual restore or copy) must not claim that folder.
    backup = Split-Path -Leaf $Backup
    sourceRoot = Get-ReviewedFullPath $SourceRoot
    kind = $Kind
    createdAt = (Get-Date).ToUniversalTime().ToString('o')
  } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $Backup $script:ReviewedBackupMarker) -Encoding UTF8
}

function Get-ReviewedCacheExclusions([string] $SourceRoot) {
  # Installation changes app files and profile settings, never these transcripts or download caches.
  $caches = @(
    'Cache', 'Code Cache', 'GPUCache', 'DawnCache', 'DawnGraphiteCache', 'DawnWebGPUCache',
    'GrShaderCache', 'ShaderCache'
  )
  $relative = @(
    'codex-runtime-home\home\sessions', 'codex-runtime-home\home\packages',
    'codex-runtime-home\home\cache', 'codex-runtime-home\home\tmp', 'speech-models'
  ) + $caches
  # Why: embedded browser partitions keep their own Chromium caches under Partitions\<name>.
  $partitions = Join-Path $SourceRoot 'Partitions'
  if (Test-Path -LiteralPath $partitions -PathType Container) {
    foreach ($partition in Get-ChildItem -LiteralPath $partitions -Directory -Force) {
      if ($partition.Attributes -band [IO.FileAttributes]::ReparsePoint) { continue }
      $relative += @($caches | ForEach-Object { "Partitions\$($partition.Name)\$_" })
    }
  }
  return $relative
}

function New-ReviewedDataBackup([string] $SourceRoot, [string] $Backup) {
  $sourcePath = Get-ReviewedFullPath $SourceRoot
  $backupPath = Get-ReviewedFullPath $Backup
  $excluded = @(Get-ReviewedCacheExclusions $sourcePath)
  New-Item -ItemType Directory -Path $backupPath -ErrorAction Stop | Out-Null
  $excludedPaths = @($excluded | ForEach-Object { Join-Path $sourcePath $_ })
  # Why the marker names in /XF: files restored from an older backup must not seed new ones.
  & robocopy.exe $sourcePath $backupPath /E /R:0 /W:0 /XJ /XD $excludedPaths /XF Cookies *.sqlite-shm *.db-shm $script:ReviewedBackupMarker $script:ReviewedBackupScope /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "Orca settings backup failed with robocopy exit code $LASTEXITCODE. No app files were changed." }
  # Why: robocopy reports success as 1 to 7; left in place it reads as a failed install to callers.
  $global:LASTEXITCODE = 0
  Write-ReviewedBackupMarker $backupPath $sourcePath 'settings'
  @{ excluded = $excluded; reason = 'Originals remain in the live Orca data directory.' } |
    ConvertTo-Json | Set-Content -LiteralPath (Join-Path $backupPath $script:ReviewedBackupScope) -Encoding UTF8
}

function Restore-ReviewedAppBackup([string] $Backup, [string] $Target, [string] $Package) {
  foreach ($entry in Get-ChildItem -LiteralPath $Backup -Force) {
    if ($entry.Name -eq $script:ReviewedBackupMarker) { continue }
    Copy-Item -LiteralPath $entry.FullName -Destination $Target -Recurse -Force
  }
  # Why: only what the failed install added is removed: package paths the pre-install backup lacks.
  $added = @(Get-ChildItem -LiteralPath $Package -Recurse -Force | ForEach-Object {
    $_.FullName.Substring($Package.TrimEnd('\').Length).TrimStart('\')
  } | Where-Object { -not (Test-Path -LiteralPath (Join-Path $Backup $_)) } | Sort-Object Length -Descending)
  foreach ($relative in $added) {
    $path = Join-Path $Target $relative
    if (Test-Path -LiteralPath $path -PathType Leaf) {
      Remove-Item -LiteralPath $path -Force
    } elseif ((Test-Path -LiteralPath $path -PathType Container) -and
      -not (Get-ChildItem -LiteralPath $path -Force | Select-Object -First 1)) {
      Remove-Item -LiteralPath $path -Force
    }
  }
}

function Remove-ExpiredReviewedBackups([string] $SourceRoot, [string] $Kind, [string[]] $Protected = @()) {
  $sourcePath = Get-ReviewedFullPath $SourceRoot
  $parent = Split-Path -Parent $sourcePath
  $leaf = Split-Path -Leaf $sourcePath
  if (-not $parent -or -not $leaf -or -not (Test-Path -LiteralPath $parent -PathType Container)) { return }
  $keep = @($Protected | Where-Object { $_ } | ForEach-Object { Get-ReviewedFullPath $_ })
  $pattern = '^' + [regex]::Escape($leaf) + '-backup-\d{8}-\d{6}-\d{3}$'
  $managed = @(Get-ChildItem -LiteralPath $parent -Directory -Force | Where-Object {
    $_.Name -match $pattern -and -not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint)
  } | Where-Object {
    $marker = Join-Path $_.FullName $script:ReviewedBackupMarker
    if (-not (Test-Path -LiteralPath $marker -PathType Leaf)) { return $false }
    try {
      $record = Get-Content -LiteralPath $marker -Raw | ConvertFrom-Json
      $record.owner -eq 'orca-reviewed-installer' -and $record.version -eq 2 -and
        $record.backup -eq $_.Name -and $record.kind -eq $Kind -and $record.sourceRoot -eq $sourcePath
    } catch { $false }
  } | Sort-Object Name -Descending)
  # Why: the backups this install made or was given always survive, whatever the clock says.
  $expired = @($managed | Select-Object -Skip $script:ReviewedBackupRetain | Where-Object {
    $keep -notcontains $_.FullName
  })
  foreach ($entry in $expired) {
    $resolved = (Resolve-Path -LiteralPath $entry.FullName).Path
    if ((Split-Path -Parent $resolved) -ne $parent -or $resolved -eq $sourcePath) {
      throw 'Backup cleanup escaped its expected parent directory.'
    }
    if (Get-ChildItem -LiteralPath $resolved -Recurse -Force | Where-Object {
      $_.Attributes -band [IO.FileAttributes]::ReparsePoint
    } | Select-Object -First 1) {
      Write-Warning "Backup contains a link and was preserved: $resolved"
      continue
    }
    # Why marker last: an interrupted delete stays marked, so the next install can finish it.
    foreach ($child in Get-ChildItem -LiteralPath $resolved -Force) {
      if ($child.Name -ne $script:ReviewedBackupMarker) {
        Remove-Item -LiteralPath $child.FullName -Recurse -Force
      }
    }
    Remove-Item -LiteralPath $resolved -Recurse -Force
  }
}
