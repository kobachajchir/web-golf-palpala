param(
  [switch]$Execute,
  [string]$Period = "all",
  [string]$Project = "webgolfclub"
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$functionsDir = Join-Path $root "functions"
$scriptPath = Join-Path $functionsDir "lib\scripts\reconcile-member-fee-renewals.js"

if (-not $env:GOOGLE_APPLICATION_CREDENTIALS) {
  $defaultCredentials = Join-Path $env:USERPROFILE "Keys\webgolfclub-adminsdk.json"
  if (Test-Path $defaultCredentials) {
    $env:GOOGLE_APPLICATION_CREDENTIALS = $defaultCredentials
  }
}

npm --prefix $functionsDir run build

$scriptArgs = @($scriptPath, "--project=$Project", "--period=$Period")
if ($Execute) {
  $scriptArgs += "--execute"
  $scriptArgs += "--yes-membership-renewals-only"
}

node @scriptArgs
