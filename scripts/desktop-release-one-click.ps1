[CmdletBinding()]
param(
  [ValidateSet('cut', 'publish', 'downloads', 'updater', 'metadata-fix', 'smoke-templates', 'plan')]
  [string]$Mode = 'plan',

  [string]$Version,
  [string]$PreviousVersion,
  [string]$ExpectedOnlineLatest,
  [string]$Remote = 'github',
  [string]$Branch,
  [string]$RunUrl,

  [switch]$Execute,
  [switch]$Publish,
  [switch]$AllowDirty,
  [switch]$AllowExistingTag,
  [switch]$Offline,
  [switch]$SkipDownloads,
  [switch]$SkipUpdater,
  [switch]$SkipGitee,
  [switch]$NoEnv
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path (Join-Path $scriptDir '..')).Path

function Import-OptionalEnv {
  param([string]$Path)

  if (Test-Path $Path) {
    Write-Host "[desktop-release-one-click] Loading env: $Path"
    . $Path
  }
}

if (-not $NoEnv) {
  Import-OptionalEnv -Path (Join-Path $scriptDir 'github-actions-env.local.ps1')
  Import-OptionalEnv -Path (Join-Path $scriptDir 'oss-env.local.ps1')
  Import-OptionalEnv -Path (Join-Path $scriptDir 'gitee-env.local.ps1')
}

$argsList = @(
  'run',
  'scripts/desktop-release-one-click.ts',
  $Mode
)

if ($Version) {
  $argsList += @('--version', $Version)
}
if ($PreviousVersion) {
  $argsList += @('--previous-version', $PreviousVersion)
}
if ($ExpectedOnlineLatest) {
  $argsList += @('--expected-online-latest', $ExpectedOnlineLatest)
}
if ($Remote) {
  $argsList += @('--remote', $Remote)
}
if ($Branch) {
  $argsList += @('--branch', $Branch)
}
if ($RunUrl) {
  $argsList += @('--run-url', $RunUrl)
}
if ($Execute) {
  $argsList += '--execute'
}
if ($Publish) {
  $argsList += '--publish'
}
if ($AllowDirty) {
  $argsList += '--allow-dirty'
}
if ($AllowExistingTag) {
  $argsList += '--allow-existing-tag'
}
if ($Offline) {
  $argsList += '--offline'
}
if ($SkipDownloads) {
  $argsList += '--skip-downloads'
}
if ($SkipUpdater) {
  $argsList += '--skip-updater'
}
if ($SkipGitee) {
  $argsList += '--skip-gitee'
}

Push-Location $repoRoot
try {
  & bun @argsList
  if ($LASTEXITCODE -ne 0) {
    throw "desktop release one-click failed with exit code $LASTEXITCODE"
  }
} finally {
  Pop-Location
}
