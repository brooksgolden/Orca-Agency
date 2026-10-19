$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot 'run-approved-grouped-chat-update.ps1'
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($source, [ref]$null, [ref]$parseErrors)
if ($parseErrors) { throw $parseErrors }
$definition = $ast.Find({param($item) $item -is [Management.Automation.Language.FunctionDefinitionAst] -and $item.Name -eq 'Start-IndependentOrca'}, $false)
if (-not $definition) { throw 'Restart function missing.' }
. ([scriptblock]::Create($definition.Extent.Text))
$exe = 'C:\restart-fixture\Orca.exe'
$target = 'C:\restart-fixture'
$toolchainRoot = 'C:\restart-fixture\toolchain'
$inspector = 'inspector-fixture'
$frozenManifest = @{packageVersion='1.4.1012'; rolloutInspectorNodeSha256=@{arm64='fixture'}}
$script:fixtureReads = 0
$script:fixtureLaunches = 0
$script:fixtureDesktopPid = 42424
$script:fixtureInspectedPids = @()
$ready = @{pid=42424; exe=$exe; version='1.4.1012'; userData=(Join-Path $env:APPDATA 'orca'); windows=@(@{visible=$true; destroyed=$false; url='file:///C:/restart-fixture/resources/app.asar/out/renderer/index.html'})}
$script:fixtureIdentities = @()
foreach ($field in @('pid','exe','version','userData','windows')) {
    $early = $ready.Clone()
    $early[$field] = switch ($field) {
        'pid' { 12345 }
        'exe' { 'C:\other-fixture\Orca.exe' }
        'version' { '0.0.0' }
        'userData' { 'C:\other-fixture\profile' }
        'windows' { @() }
    }
    $script:fixtureIdentities += $early
}
$hidden = $ready.Clone()
$hidden.windows = @(@{visible=$false; destroyed=$false; url=$ready.windows[0].url})
$script:fixtureIdentities += $hidden
$script:fixtureIdentities += $ready
function Get-ReviewedInspectorNode { return 'Invoke-FixtureInspector' }
function Invoke-CimMethod {
    param($ClassName, $MethodName, $Arguments)
    if ($ClassName -ne 'Win32_Process' -or $MethodName -ne 'Create' -or $Arguments.CurrentDirectory -ne $target) { throw 'Unexpected launch.' }
    $script:fixtureLaunches++
    return @{ReturnValue=0; ProcessId=42424}
}
function Start-Sleep {}
function Get-Process {
    $mockProcess = [pscustomobject]@{Id=$script:fixtureDesktopPid; Path=$exe; MainWindowHandle=1}
    $mockProcess | Add-Member ScriptMethod Dispose {}
    return $mockProcess
}
function Invoke-FixtureInspector {
    if ($args[0] -eq '-e') {
        $script:fixtureInspectedPids += $args[2]
        $global:LASTEXITCODE=0
        return
    }
    if ($args[0] -ne $inspector) { throw 'Unexpected inspector invocation.' }
    $index = $script:fixtureReads++
    if ($index -ge $script:fixtureIdentities.Count) { throw 'Readiness never matched.' }
    $global:LASTEXITCODE=0
    return @{result=@{result=@{value=$script:fixtureIdentities[$index]}}} | ConvertTo-Json -Depth 8 -Compress
}
function Get-ReviewedInstallProcesses { throw 'A transient startup identity triggered shutdown.' }
Start-IndependentOrca
if ($script:fixtureReads -ne 7 -or $script:fixtureLaunches -ne 1 -or @($script:fixtureInspectedPids | Where-Object { $_ -ne 42424 }).Count) {
    throw 'Restart did not wait through every transient identity.'
}
$script:fixtureDesktopPid = 55555
$script:fixtureReads = 0
$script:fixtureInspectedPids = @()
$handoffReady = $ready.Clone()
$handoffReady.pid = $script:fixtureDesktopPid
$script:fixtureIdentities = @($handoffReady)
Start-IndependentOrca
if ($script:fixtureReads -ne 1 -or $script:fixtureLaunches -ne 2 -or
    @($script:fixtureInspectedPids | Where-Object { $_ -ne $script:fixtureDesktopPid }).Count) {
    throw 'Restart did not verify the desktop after Windows handed off the launch PID.'
}
Write-Output 'PASS: restart waits through transient identities and verifies a desktop that handed off to another PID without closing it.'
