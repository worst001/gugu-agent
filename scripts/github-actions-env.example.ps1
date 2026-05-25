# Copy to scripts/github-actions-env.local.ps1 and fill locally.
# The .local.ps1 file is ignored by git.

$env:GUGU_GITHUB_TOKEN = "paste_github_token_here"
$env:GUGU_GITHUB_REPO = "worst001/gugu-agent"
$env:GUGU_GITHUB_REF = "main"

Write-Host "Gugu GitHub Actions environment loaded for repo: $env:GUGU_GITHUB_REPO"
Write-Host "Build-only CI can also run without this token by pushing the ci/desktop-release branch."
