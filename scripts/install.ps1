# Install dsh-element-source into the default desktop profile.
# Idempotent: safe to re-run (updates the package).
param(
    [string]$Version
)

$ErrorActionPreference = 'Stop'

$Profile = if ($env:DSH_PROFILE) { $env:DSH_PROFILE } else { 'desktop' }
$DshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $HOME '.dsh' }
$ProfileDir = Join-Path $DshHome "profiles\$Profile"

if (-not (Test-Path $ProfileDir)) {
    Write-Host "profile '$Profile' not found at $ProfileDir" -ForegroundColor Red
    Write-Host "start the DSH desktop app once so the profile initializes, then retry"
    exit 1
}

Push-Location $ProfileDir
try {
    # pnpm >=10 blocks <24h-old packages; pre-allow this one so the first
    # install never fails on release age. Insert the entry directly under the
    # existing `minimumReleaseAgeExclude:` list (or append the block when the
    # key is absent).
    $WorkspaceFile = Join-Path $ProfileDir 'pnpm-workspace.yaml'
    if (-not (Test-Path $WorkspaceFile)) { New-Item -ItemType File -Path $WorkspaceFile | Out-Null }
    $hasEntry = Select-String -Path $WorkspaceFile -Pattern '^  - dsh-element-source$' -Quiet
    if (-not $hasEntry) {
        $hasBlock = Select-String -Path $WorkspaceFile -Pattern '^minimumReleaseAgeExclude:' -Quiet
        if ($hasBlock) {
            $lines = @(Get-Content -Path $WorkspaceFile)
            $out = New-Object System.Collections.Generic.List[string]
            $inserted = $false
            foreach ($line in $lines) {
                $out.Add($line)
                if (-not $inserted -and $line -match '^minimumReleaseAgeExclude:') {
                    $out.Add('  - dsh-element-source')
                    $inserted = $true
                }
            }
            Set-Content -Path $WorkspaceFile -Value $out -Encoding UTF8
        } else {
            Add-Content -Path $WorkspaceFile -Value "minimumReleaseAgeExclude:`n  - dsh-element-source" -Encoding UTF8
        }
    }

    $Package = if ($Version) { "dsh-element-source@$Version" } else { 'dsh-element-source' }
    npx -y --package @deepseek-ai/dsh dsh plugin --profile $Profile add $Package

    Write-Host ""
    Write-Host 'Installed. Restart the DSH desktop app or reload its window to load the client half.'
}
finally {
    Pop-Location
}
