# Install dsh-element-source into the default web profile.
# Idempotent: safe to re-run (updates the package).
param(
    [string]$Version,
    [switch]$Restart
)

$ErrorActionPreference = 'Stop'

$Profile = if ($env:DSH_PROFILE) { $env:DSH_PROFILE } else { 'web' }
$DshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $HOME '.dsh' }
$ProfileDir = Join-Path $DshHome "profiles\$Profile"

if (-not (Test-Path $ProfileDir)) {
    Write-Host "profile '$Profile' not found at $ProfileDir" -ForegroundColor Red
    Write-Host "run 'dsh web' once so the profile initializes, then retry"
    exit 1
}

Push-Location $ProfileDir
try {
    # pnpm >=10 blocks <24h-old packages; pre-allow this one so the first
    # install never fails on release age.
    $WorkspaceFile = Join-Path $ProfileDir 'pnpm-workspace.yaml'
    if (-not (Test-Path $WorkspaceFile)) { New-Item -ItemType File -Path $WorkspaceFile | Out-Null }
    $Workspace = Get-Content $WorkspaceFile -Raw
    if ($Workspace -notmatch '^  - dsh-element-source$' -and $Workspace -notmatch 'dsh-element-source') {
        if ($Workspace -match '^minimumReleaseAgeExclude:') {
            Add-Content -Path $WorkspaceFile -Value "  - dsh-element-source"
        } else {
            Add-Content -Path $WorkspaceFile -Value "`nminimumReleaseAgeExclude:`n  - dsh-element-source"
        }
    }

    $Package = if ($Version) { "dsh-element-source@$Version" } else { 'dsh-element-source' }
    npx -y --package @deepseek-ai/dsh dsh plugin --profile $Profile add $Package

    Write-Host ""
    Write-Host 'Installed. Hard-refresh the browser (Cmd/Ctrl+Shift+R) to load the client half.'

    if ($Restart) {
        Write-Host 'Restarting dsh web...'
        dsh web
    }
}
finally {
    Pop-Location
}
