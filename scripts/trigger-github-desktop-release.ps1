param(
  [string]$Repo = $env:GUGU_GITHUB_REPO,
  [string]$Ref = $env:GUGU_GITHUB_REF,
  [string]$Workflow = "release-desktop.yml",
  [string]$Remote = "github",
  [string]$CiBranch = "ci/desktop-release",
  [ValidateSet("true", "false")]
  [string]$Publish = "false",
  [ValidateSet("true", "false")]
  [string]$RequireUpdater = "true"
)

if (-not $Repo) {
  $Repo = "worst001/gugu-agent"
}

if (-not $Ref) {
  $Ref = "main"
}

$token = $env:GUGU_GITHUB_TOKEN
if (-not $token) {
  if ($Publish -eq "true") {
    throw "Missing GUGU_GITHUB_TOKEN. publish=true uses workflow_dispatch, so create a GitHub fine-grained token with Actions: write and Contents: read, then set `$env:GUGU_GITHUB_TOKEN."
  }

  Write-Host "GUGU_GITHUB_TOKEN is not set; using push-trigger mode for build-only CI."
  git push $Remote "HEAD:refs/heads/$CiBranch" --force
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to push $CiBranch to remote $Remote."
  }
  Write-Host "Triggered GitHub Actions by pushing branch: $CiBranch"
  Write-Host "publish=false require_updater=true"
  Write-Host "Actions: https://github.com/$Repo/actions/workflows/$Workflow"
  exit 0
}

$uri = "https://api.github.com/repos/$Repo/actions/workflows/$Workflow/dispatches"
$body = @{
  ref = $Ref
  inputs = @{
    publish = $Publish
    require_updater = $RequireUpdater
  }
} | ConvertTo-Json -Depth 5

$headers = @{
  Authorization = "Bearer $token"
  Accept = "application/vnd.github+json"
  "X-GitHub-Api-Version" = "2022-11-28"
  "User-Agent" = "gugu-agent-release-script"
}

Invoke-RestMethod -Method Post -Uri $uri -Headers $headers -ContentType "application/json" -Body $body | Out-Null

Write-Host "Triggered GitHub Actions workflow: $Workflow"
Write-Host "Repo: $Repo"
Write-Host "Ref: $Ref"
Write-Host "publish=$Publish require_updater=$RequireUpdater"
Write-Host "Actions: https://github.com/$Repo/actions/workflows/$Workflow"
