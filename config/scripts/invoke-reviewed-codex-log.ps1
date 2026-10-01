function Invoke-ReviewedCodexLog {
    param(
        [Parameter(Mandatory)][string]$Executable,
        [Parameter(Mandatory)][string[]]$Arguments,
        [Parameter(Mandatory)][string]$PromptText,
        [Parameter(Mandatory)][string]$Log,
        [Parameter(Mandatory)][string]$ErrorLog
    )
    $priorPreference = $ErrorActionPreference
    try {
        # Windows PowerShell 5.1 turns native stderr into ErrorRecords.
        $ErrorActionPreference = 'Continue'
        $PromptText | & $Executable @Arguments 2> $ErrorLog |
            Out-File -LiteralPath $Log -Encoding utf8 -ErrorAction Stop
        $nativeExitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $priorPreference
    }
    if ($nativeExitCode -ne 0) {
        throw "Pinned Codex run failed with exit code $nativeExitCode. Inspect $Log and $ErrorLog"
    }
}
