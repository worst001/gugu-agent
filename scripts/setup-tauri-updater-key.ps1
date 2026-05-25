[CmdletBinding()]
param(
  [string]$KeyPath,
  [string]$Password,
  [switch]$GeneratePassword,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path (Join-Path $scriptDir '..')).Path
$desktopDir = Join-Path $repoRoot 'desktop'
$tauriConfigPath = Join-Path $desktopDir 'src-tauri\tauri.conf.json'

function Write-Step {
  param([string]$Message)
  Write-Host "[setup-tauri-updater-key] $Message"
}

function New-RandomPassword {
  $bytes = New-Object byte[] 32
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($bytes)
  } finally {
    $rng.Dispose()
  }
  return [Convert]::ToBase64String($bytes)
}

function Read-PasswordFromPrompt {
  $secure = Read-Host 'Enter Tauri updater signing password' -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}

function Write-Utf8NoBom {
  param(
    [string]$Path,
    [string]$Value
  )

  $encoding = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Value, $encoding)
}

if (-not $KeyPath) {
  $KeyPath = Join-Path $repoRoot 'secrets\tauri-updater.key'
}

$keyDir = Split-Path -Parent $KeyPath
if (-not $keyDir) {
  throw 'KeyPath must include a directory.'
}

if (-not $Password) {
  if ($GeneratePassword) {
    $Password = New-RandomPassword
  } else {
    $Password = Read-PasswordFromPrompt
  }
}

if (-not $Password) {
  throw 'Updater signing password cannot be empty.'
}

if ((Test-Path $KeyPath) -and -not $Force) {
  throw "Key already exists: $KeyPath. Pass -Force to overwrite it."
}

New-Item -ItemType Directory -Force -Path $keyDir | Out-Null

Push-Location $desktopDir
try {
  & bunx tauri signer generate --ci -f -w $KeyPath -p $Password
  if ($LASTEXITCODE -ne 0) {
    throw "tauri signer generate failed with exit code $LASTEXITCODE"
  }
} finally {
  Pop-Location
}

$publicKeyPath = "$KeyPath.pub"
if (-not (Test-Path $publicKeyPath)) {
  throw "Public key was not generated: $publicKeyPath"
}

$publicKey = (Get-Content -Path $publicKeyPath -Raw).Trim()
if (-not $publicKey) {
  throw "Public key file is empty: $publicKeyPath"
}

$tauriConfigJson = Get-Content -Path $tauriConfigPath -Raw
$updatedTauriConfigJson = [regex]::Replace(
  $tauriConfigJson,
  '("pubkey"\s*:\s*")[^"]*(")',
  "`${1}$publicKey`${2}",
  1
)

if ($updatedTauriConfigJson -eq $tauriConfigJson) {
  throw "Could not find updater pubkey in $tauriConfigPath"
}

Write-Utf8NoBom -Path $tauriConfigPath -Value $updatedTauriConfigJson

$windowsEnvPath = Join-Path $scriptDir 'updater-env.local.ps1'
$escapedWindowsKeyPath = $KeyPath.Replace("'", "''")
$escapedWindowsPassword = $Password.Replace("'", "''")
$windowsEnv = @"
`$env:TAURI_SIGNING_PRIVATE_KEY_PATH = '$escapedWindowsKeyPath'
`$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = '$escapedWindowsPassword'
Write-Host 'Tauri updater signing env loaded. Build scripts can now emit updater artifacts.'
"@
Write-Utf8NoBom -Path $windowsEnvPath -Value $windowsEnv

$macEnvPath = Join-Path $scriptDir 'updater-env.local.sh'
$escapedMacPassword = $Password.Replace("'", "'\''")
$macEnv = @"
#!/usr/bin/env bash
# Copy secrets/tauri-updater.key to your Mac, then edit this path.
export TAURI_SIGNING_PRIVATE_KEY_PATH="/absolute/path/to/tauri-updater.key"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD='${escapedMacPassword}'
export SIGN_BUILD=1
"@
Write-Utf8NoBom -Path $macEnvPath -Value $macEnv

Write-Step "Updated updater public key in $tauriConfigPath"
Write-Step "Private key written to $KeyPath"
Write-Step "Windows env helper written to $windowsEnvPath"
Write-Step "Mac env helper template written to $macEnvPath"
Write-Step 'Keep secrets/ and scripts/*local* files out of git.'
