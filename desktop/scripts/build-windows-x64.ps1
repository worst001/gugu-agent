[CmdletBinding()]
param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$TauriArgs
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$desktopDir = (Resolve-Path (Join-Path $scriptDir '..')).Path
$repoRoot = (Resolve-Path (Join-Path $desktopDir '..')).Path

$targetTriple = 'x86_64-pc-windows-msvc'
$tauriTargetDir = Join-Path $desktopDir 'src-tauri\target'
$canonicalOutputDir = Join-Path $desktopDir 'build-artifacts\windows-x64'
$activeOutputDir = $canonicalOutputDir
$appVersion = (Get-Content -Path (Join-Path $desktopDir 'src-tauri\tauri.conf.json') -Raw | ConvertFrom-Json).version

function Write-Step {
  param([string]$Message)
  Write-Host "[build-windows-x64] $Message"
}

function Write-Utf8NoBom {
  param(
    [string]$Path,
    [string]$Value
  )

  $encoding = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Value, $encoding)
}

function Invoke-MsiQuery {
  param(
    [object]$Database,
    [string]$Sql,
    [int]$FieldCount
  )

  $view = $Database.GetType().InvokeMember('OpenView', 'InvokeMethod', $null, $Database, @($Sql))
  try {
    $view.GetType().InvokeMember('Execute', 'InvokeMethod', $null, $view, $null) | Out-Null
    $rows = New-Object System.Collections.Generic.List[object]

    while ($true) {
      $record = $view.GetType().InvokeMember('Fetch', 'InvokeMethod', $null, $view, $null)
      if ($null -eq $record) {
        break
      }

      $fields = @()
      for ($index = 1; $index -le $FieldCount; $index++) {
        $fields += $record.GetType().InvokeMember('StringData', 'GetProperty', $null, $record, @([int]$index))
      }
      $rows.Add($fields) | Out-Null
    }

    return $rows
  } finally {
    $view.GetType().InvokeMember('Close', 'InvokeMethod', $null, $view, $null) | Out-Null
  }
}

function Remove-AppUserModelShortcutProperty {
  param([string]$MsiPath)

  $installer = New-Object -ComObject WindowsInstaller.Installer
  $database = $installer.GetType().InvokeMember('OpenDatabase', 'InvokeMethod', $null, $installer, @($MsiPath, 1))

  $tables = Invoke-MsiQuery -Database $database -Sql 'SELECT Name FROM _Tables' -FieldCount 1
  $tableNames = @($tables | ForEach-Object { $_[0] })
  if (-not ($tableNames -contains 'MsiShortcutProperty')) {
    Write-Step "MSI has no MsiShortcutProperty table: $MsiPath"
    return
  }

  $before = Invoke-MsiQuery `
    -Database $database `
    -Sql "SELECT MsiShortcutProperty, Shortcut_, PropertyKey, PropVariantValue FROM MsiShortcutProperty WHERE PropertyKey='System.AppUserModel.ID'" `
    -FieldCount 4

  if ($before.Count -eq 0) {
    Write-Step "MSI has no System.AppUserModel.ID shortcut property: $MsiPath"
    return
  }

  $deleteView = $database.GetType().InvokeMember(
    'OpenView',
    'InvokeMethod',
    $null,
    $database,
    @("DELETE FROM MsiShortcutProperty WHERE PropertyKey='System.AppUserModel.ID'")
  )
  try {
    $deleteView.GetType().InvokeMember('Execute', 'InvokeMethod', $null, $deleteView, $null) | Out-Null
  } finally {
    $deleteView.GetType().InvokeMember('Close', 'InvokeMethod', $null, $deleteView, $null) | Out-Null
  }

  $database.GetType().InvokeMember('Commit', 'InvokeMethod', $null, $database, $null) | Out-Null
  Write-Step "Removed $($before.Count) System.AppUserModel.ID shortcut propert$(if ($before.Count -eq 1) { 'y' } else { 'ies' }) from MSI"
}

function Update-TauriSignature {
  param([string]$ArtifactPath)

  if (-not $env:TAURI_SIGNING_PRIVATE_KEY) {
    return
  }

  Write-Step "Re-signing updater artifact: $ArtifactPath"
  Push-Location $desktopDir
  try {
    $signature = (& bunx tauri signer sign $ArtifactPath)
    if ($LASTEXITCODE -ne 0) {
      throw "[build-windows-x64] Failed to sign updater artifact: $ArtifactPath"
    }
    Write-Utf8NoBom -Path "$ArtifactPath.sig" -Value (($signature -join "`n").Trim())
  } finally {
    Pop-Location
  }
}

function Assert-WindowsHost {
  $isWindows = ([System.Environment]::OSVersion.Platform -eq [System.PlatformID]::Win32NT) -or ($env:OS -eq 'Windows_NT')
  if (-not $isWindows) {
    throw '[build-windows-x64] This script must run on Windows.'
  }
}

function Assert-Command {
  param([string]$Name)

  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "[build-windows-x64] Missing required command: $Name"
  }
}

function Import-VsDevEnvironment {
  $vswhere = 'C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe'
  if (-not (Test-Path $vswhere)) {
    throw '[build-windows-x64] Could not find vswhere.exe. Install Visual Studio 2022 Build Tools with the C++ workload.'
  }

  $installationPath = & $vswhere `
    -products * `
    -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
    -property installationPath |
    Select-Object -First 1

  if (-not $installationPath) {
    throw '[build-windows-x64] Missing Visual C++ build tools. Install the "Desktop development with C++" / VC.Tools.x86.x64 workload first.'
  }

  $vsDevCmd = Join-Path $installationPath 'Common7\Tools\VsDevCmd.bat'
  if (-not (Test-Path $vsDevCmd)) {
    throw "[build-windows-x64] Could not find VsDevCmd.bat under $installationPath"
  }

  Write-Step "Importing MSVC environment from $vsDevCmd"

  $env:VSCMD_SKIP_SENDTELEMETRY = '1'
  $envDump = & cmd.exe /d /s /c "`"$vsDevCmd`" -arch=x64 -host_arch=x64 >nul && set"
  if ($LASTEXITCODE -ne 0) {
    throw "[build-windows-x64] Failed to initialize Visual Studio build environment (exit $LASTEXITCODE)"
  }

  foreach ($line in $envDump) {
    if ($line -match '^(.*?)=(.*)$') {
      [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process')
    }
  }
}

function Get-RustCargoBinDir {
  return Join-Path $env:USERPROFILE '.cargo\bin'
}

function Ensure-RustInPath {
  $cargoBinDir = Get-RustCargoBinDir
  if ((Test-Path $cargoBinDir) -and -not (($env:Path -split ';') -contains $cargoBinDir)) {
    $env:Path = "$cargoBinDir;$env:Path"
  }
}

function Get-LatestArtifact {
  param(
    [string[]]$SearchRoots,
    [string[]]$Patterns
  )

  foreach ($root in $SearchRoots) {
    if (-not (Test-Path $root)) {
      continue
    }

    foreach ($pattern in $Patterns) {
      $match = Get-ChildItem -Path $root -File -Filter $pattern -ErrorAction SilentlyContinue |
        Sort-Object Name |
        Select-Object -Last 1

      if ($match) {
        return $match
      }
    }
  }

  return $null
}

function Get-StagedArtifactName {
  param([string]$ArtifactName)

  switch -Regex ($ArtifactName) {
    '^latest\.json$' { return 'latest.json' }
    '\.msi\.zip\.sig$' { return "Gugu-Agent-${appVersion}-windows-x64.msi.zip.sig" }
    '\.msi\.zip$' { return "Gugu-Agent-${appVersion}-windows-x64.msi.zip" }
    '\.msi\.sig$' { return "Gugu-Agent-${appVersion}-windows-x64.msi.sig" }
    '\.msi$' { return "Gugu-Agent-${appVersion}-windows-x64.msi" }
    default { return $ArtifactName }
  }
}

function Test-ArtifactMatchesAppVersion {
  param([string]$ArtifactName)

  if ($ArtifactName -eq 'latest.json') {
    return $true
  }

  return $ArtifactName.Contains("_$appVersion") -or $ArtifactName.Contains("-$appVersion")
}

function Resolve-OutputDirectory {
  param([string]$PreferredPath)

  New-Item -ItemType Directory -Force -Path $PreferredPath | Out-Null

  $existingArtifacts = Get-ChildItem -Path $PreferredPath -Force -ErrorAction SilentlyContinue
  foreach ($artifact in $existingArtifacts) {
    try {
      Remove-Item -LiteralPath $artifact.FullName -Force -Recurse
    } catch {
      $fallbackPath = "$PreferredPath-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
      Write-Step "Could not clear locked artifact '$($artifact.FullName)'. Using fallback output directory: $fallbackPath"
      New-Item -ItemType Directory -Force -Path $fallbackPath | Out-Null
      return $fallbackPath
    }
  }

  return $PreferredPath
}

Assert-WindowsHost
Assert-Command bun

Ensure-RustInPath
Import-VsDevEnvironment

Assert-Command cargo
Assert-Command rustc
Assert-Command bunx

if ($env:SKIP_INSTALL -ne '1') {
  Write-Step 'Installing root dependencies...'
  Push-Location $repoRoot
  try {
    & bun install
    if ($LASTEXITCODE -ne 0) {
      throw "[build-windows-x64] bun install failed in repo root (exit $LASTEXITCODE)"
    }
  } finally {
    Pop-Location
  }

  Write-Step 'Installing desktop dependencies...'
  Push-Location $desktopDir
  try {
    & bun install
    if ($LASTEXITCODE -ne 0) {
      throw "[build-windows-x64] bun install failed in desktop (exit $LASTEXITCODE)"
    }
  } finally {
    Pop-Location
  }

  $adaptersDir = Join-Path $repoRoot 'adapters'
  if (Test-Path (Join-Path $adaptersDir 'package.json')) {
    Write-Step 'Installing adapter dependencies...'
    Push-Location $adaptersDir
    try {
      & bun install
      if ($LASTEXITCODE -ne 0) {
        throw "[build-windows-x64] bun install failed in adapters (exit $LASTEXITCODE)"
      }
    } finally {
      Pop-Location
    }
  }
}

$tauriBuildArgs = @(
  'tauri',
  'build',
  '--target',
  $targetTriple,
  '--bundles',
  'msi',
  '--ci'
)

if ((-not $env:TAURI_SIGNING_PRIVATE_KEY) -and $env:TAURI_SIGNING_PRIVATE_KEY_PATH) {
  if (-not (Test-Path $env:TAURI_SIGNING_PRIVATE_KEY_PATH)) {
    throw "[build-windows-x64] TAURI_SIGNING_PRIVATE_KEY_PATH does not exist: $env:TAURI_SIGNING_PRIVATE_KEY_PATH"
  }
  $env:TAURI_SIGNING_PRIVATE_KEY = Get-Content -Path $env:TAURI_SIGNING_PRIVATE_KEY_PATH -Raw
}

$hasUpdaterSigningKey = $env:TAURI_SIGNING_PRIVATE_KEY
$tempConfigPath = $null
if (-not $hasUpdaterSigningKey) {
  $tempConfigPath = Join-Path ([System.IO.Path]::GetTempPath()) 'cc-haha.tauri.local.windows.json'
  $tempConfig = @{
    bundle = @{
      createUpdaterArtifacts = $false
    }
  } | ConvertTo-Json -Depth 10
  Set-Content -Path $tempConfigPath -Value $tempConfig -Encoding UTF8
  Write-Step 'No Tauri updater signing key set, disabling updater artifacts for local build'
  $tauriBuildArgs += @('--config', $tempConfigPath)
}

if ($null -ne $TauriArgs) {
  $remainingArgs = @($TauriArgs)
  if ($remainingArgs.Count -gt 0) {
    $tauriBuildArgs += $remainingArgs
  }
}

Write-Step "Building Windows desktop app for $targetTriple"

Push-Location $desktopDir
try {
  $env:TAURI_ENV_TARGET_TRIPLE = $targetTriple
  & bunx @tauriBuildArgs
  if ($LASTEXITCODE -ne 0) {
    throw "[build-windows-x64] tauri build failed (exit $LASTEXITCODE)"
  }
} finally {
  Pop-Location
  if ($tempConfigPath -and (Test-Path $tempConfigPath)) {
    Remove-Item -LiteralPath $tempConfigPath -Force
  }
}

$bundleRoots = @(
  (Join-Path $tauriTargetDir "$targetTriple\release\bundle"),
  (Join-Path $tauriTargetDir 'release\bundle')
)

foreach ($root in $bundleRoots) {
  if (-not (Test-Path $root)) {
    continue
  }

  $msiArtifacts = Get-ChildItem -Path $root -Recurse -File -Filter "*.msi" -ErrorAction SilentlyContinue |
    Where-Object { Test-ArtifactMatchesAppVersion -ArtifactName $_.Name }

  foreach ($artifact in $msiArtifacts) {
    Remove-AppUserModelShortcutProperty -MsiPath $artifact.FullName
    Update-TauriSignature -ArtifactPath $artifact.FullName
  }
}

$activeOutputDir = Resolve-OutputDirectory -PreferredPath $canonicalOutputDir

$artifactPatterns = @('*.msi', '*.msi.sig', '*.msi.zip', '*.msi.zip.sig', 'latest.json')
$copiedArtifacts = New-Object System.Collections.Generic.List[string]

foreach ($root in $bundleRoots) {
  if (-not (Test-Path $root)) {
    continue
  }

  foreach ($pattern in $artifactPatterns) {
    $artifacts = Get-ChildItem -Path $root -Recurse -File -Filter $pattern -ErrorAction SilentlyContinue
    foreach ($artifact in $artifacts) {
      if (-not (Test-ArtifactMatchesAppVersion -ArtifactName $artifact.Name)) {
        continue
      }

      $destinationName = Get-StagedArtifactName -ArtifactName $artifact.Name
      $destination = Join-Path $activeOutputDir $destinationName
      Copy-Item -LiteralPath $artifact.FullName -Destination $destination -Force
      if (-not $copiedArtifacts.Contains($destination)) {
        $copiedArtifacts.Add($destination) | Out-Null
      }
    }
  }
}

$msiInstaller = Get-LatestArtifact -SearchRoots @(
  (Join-Path $tauriTargetDir "$targetTriple\release\bundle\msi"),
  (Join-Path $tauriTargetDir 'release\bundle\msi')
) -Patterns @("*$appVersion*.msi")

$msiInstallerPath = if ($msiInstaller) { $msiInstaller.FullName } else { 'not found' }

$canonicalMsiPath = Join-Path $activeOutputDir "Gugu-Agent-${appVersion}-windows-x64.msi"
$canonicalMsiSignaturePath = "$canonicalMsiPath.sig"
$canonicalLatestJsonPath = Join-Path $activeOutputDir 'latest.json'

if ((Test-Path $canonicalMsiPath) -and (Test-Path $canonicalMsiSignaturePath)) {
  $updaterBaseUrl = if ($env:GUGU_UPDATER_BASE_URL) {
    $env:GUGU_UPDATER_BASE_URL.TrimEnd('/')
  } else {
    'https://gxy-download.oss-cn-shanghai.aliyuncs.com'
  }
  $signature = (Get-Content -Path $canonicalMsiSignaturePath -Raw).Trim()
  $manifest = @{
    version = $appVersion
    pub_date = [DateTimeOffset]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ')
    platforms = @{
      'windows-x86_64' = @{
        url = "$updaterBaseUrl/Gugu-Agent-${appVersion}-windows-x64.msi"
        signature = $signature
      }
    }
  } | ConvertTo-Json -Depth 10
  Write-Utf8NoBom -Path $canonicalLatestJsonPath -Value $manifest
  if (-not $copiedArtifacts.Contains($canonicalLatestJsonPath)) {
    $copiedArtifacts.Add($canonicalLatestJsonPath) | Out-Null
  }
}

$buildInfo = @(
  "App version: $appVersion"
  "Target triple: $targetTriple"
  "Canonical output: $canonicalOutputDir"
  "Actual output: $activeOutputDir"
  "Windows installer (MSI): $msiInstallerPath"
  "Artifacts copied: $($copiedArtifacts.Count)"
  "Built at: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')"
)

Set-Content -Path (Join-Path $activeOutputDir 'BUILD_INFO.txt') -Value $buildInfo -Encoding UTF8

Write-Host ''
Write-Step 'Build finished.'
Write-Step "Artifacts output: $activeOutputDir"
if ($msiInstaller) {
  Write-Step "MSI installer source: $($msiInstaller.FullName)"
} else {
  Write-Step 'No MSI installer found under bundle directories.'
}

Write-Step "Canonical output: $canonicalOutputDir"

if ($env:OPEN_OUTPUT -eq '1') {
  Invoke-Item $canonicalOutputDir
}
