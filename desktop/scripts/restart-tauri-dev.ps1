param(
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
  [int[]]$Ports = @(1420, 3456),
  [switch]$NoStart
)

$ErrorActionPreference = "Continue"

function Stop-ProcessByImageName {
  param([string]$ImageName)

  Write-Host "[restart] stopping $ImageName"
  & taskkill.exe /F /T /IM $ImageName 2>$null | Out-Null
}

function Stop-PortOwners {
  param([int[]]$TargetPorts)

  foreach ($port in $TargetPorts) {
    Write-Host "[restart] freeing port $port"
    Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty OwningProcess -Unique |
      Where-Object { $_ -and $_ -ne $PID } |
      ForEach-Object {
        Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue
      }
  }
}

$repoRootInput = $RepoRoot.Trim().Trim('"')
$repo = (Resolve-Path -LiteralPath $repoRootInput -ErrorAction Stop).Path
$desktopDir = Join-Path $repo "desktop"
$debugSidecar = Join-Path $repo "desktop\src-tauri\target\debug\claude-sidecar.exe"

if (-not (Test-Path -LiteralPath $desktopDir -PathType Container)) {
  Write-Error "[restart] desktop directory not found: $desktopDir"
  exit 1
}

@(
  "claude-sidecar.exe",
  "claude-sidecar-x86_64-pc-windows-msvc.exe",
  "claude-sidecar-aarch64-pc-windows-msvc.exe",
  "claude-code-desktop.exe",
  "Claude Code GuGu.exe",
  "cargo.exe",
  "rustc.exe"
) | ForEach-Object { Stop-ProcessByImageName $_ }

Stop-PortOwners -TargetPorts $Ports

Write-Host "[restart] waiting for processes to exit"
Start-Sleep -Seconds 2

Write-Host "[restart] removing stale debug sidecar"
Remove-Item -LiteralPath $debugSidecar -Force -ErrorAction SilentlyContinue

if ($NoStart) {
  Write-Host "[restart] cleanup complete; skipped dev server start because -NoStart was provided"
  exit 0
}

Write-Host "[restart] starting Tauri dev from $desktopDir"
Set-Location -LiteralPath $desktopDir
bun run tauri dev
