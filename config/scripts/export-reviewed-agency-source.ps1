[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{40}$')][string]$SourceCommit,
    [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{40}$')][string]$ReviewedPublicBase,
    [Parameter(Mandatory)][ValidatePattern('^v[0-9]+\.[0-9]+\.[0-9]+$')][string]$StableBase
)
$ErrorActionPreference = 'Stop'
$env:GIT_TERMINAL_PROMPT = '0'
$env:GCM_INTERACTIVE = 'Never'
function Invoke-VerifiedGit {
    param([Parameter(ValueFromRemainingArguments)][string[]]$GitArguments)
    $savedErrorPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $result = & git -c credential.interactive=false @GitArguments 2>$null
        $gitExitCode = $LASTEXITCODE
    } finally { $ErrorActionPreference = $savedErrorPreference }
    if ($gitExitCode -ne 0) { throw "Git failed: $($GitArguments[0]). No interactive authentication will be attempted." }
    return $result
}
Push-Location (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
try {
    if ((Invoke-VerifiedGit rev-parse HEAD).Trim() -ne $SourceCommit) { throw 'Source HEAD differs from the verified candidate.' }
    if (Invoke-VerifiedGit status --porcelain) { throw 'Source contains uncommitted changes.' }
    $remoteUrl = (Invoke-VerifiedGit remote get-url agency).Trim()
    if ($remoteUrl -ne 'https://github.com/brooksgolden/Orca-Agency.git') { throw 'Unexpected public fork remote.' }
    $upstreamUrl = (Invoke-VerifiedGit remote get-url origin).Trim()
    if ($upstreamUrl -ne 'https://github.com/stablyai/orca.git') { throw 'Unexpected upstream remote.' }
    Invoke-VerifiedGit fetch agency main | Out-Null
    $publicBase = (Invoke-VerifiedGit rev-parse refs/remotes/agency/main).Trim()
    if ($publicBase -ne $ReviewedPublicBase) { throw 'The public branch changed after review. Reconcile those edits and repeat review.' }
    $stableCommit = (Invoke-VerifiedGit rev-parse "$StableBase^{commit}").Trim()
    $tagRef = "refs/tags/$StableBase"
    $upstreamTags = @(Invoke-VerifiedGit ls-remote --tags origin $tagRef "$tagRef^{}")
    $upstreamCommit = $null
    foreach ($tag in $upstreamTags) {
        $parts = $tag -split '\s+', 2
        if ($parts[1] -eq "$tagRef^{}") { $upstreamCommit = $parts[0]; break }
        if ($parts[1] -eq $tagRef) { $upstreamCommit = $parts[0] }
    }
    if (-not $upstreamCommit -or $upstreamCommit -ne $stableCommit) {
        throw 'The stable parent does not match the tag published by the verified upstream.'
    }
    Invoke-VerifiedGit merge-base --is-ancestor $stableCommit $SourceCommit | Out-Null
    $tree = (Invoke-VerifiedGit rev-parse "$SourceCommit^{tree}").Trim()
    if (-not $PSCmdlet.ShouldProcess('Orca Agency public main', 'Publish the verified tree with public and upstream ancestry only')) { return }
    $message = "feat: update Orca Agency against $StableBase`n`nPublish the reviewed source tree while preserving the real upstream fork ancestry.`n`nCo-Authored-By: Codex <codex@openai.com>"
    $publicCommit = ($message | & git -c credential.interactive=false commit-tree $tree -p $publicBase -p $stableCommit).Trim()
    if ($LASTEXITCODE -ne 0) { throw 'Could not record public source commit.' }
    if ((Invoke-VerifiedGit rev-parse "$publicCommit^{tree}").Trim() -ne $tree) { throw 'Public tree differs from the reviewed source.' }
    if ((Invoke-VerifiedGit rev-parse HEAD).Trim() -ne $SourceCommit -or (Invoke-VerifiedGit status --porcelain)) {
        throw 'Source changed during publication. Repeat verification before pushing.'
    }
    Invoke-VerifiedGit push agency "${publicCommit}:refs/heads/main" | Out-Null
    [pscustomobject]@{ appSourceCommit=$SourceCommit; publicSourceCommit=$publicCommit; stableBase=$StableBase; repository='brooksgolden/Orca-Agency'; tree=$tree } | ConvertTo-Json
} finally { Pop-Location }
