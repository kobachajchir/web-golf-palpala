param(
  [switch]$Execute,
  [string]$Project = "webgolfclub"
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$functionsDir = Join-Path $root "functions"
$scriptPath = Join-Path $functionsDir "lib\scripts\sync-payment-methods.js"

if (-not $env:GOOGLE_APPLICATION_CREDENTIALS) {
  $defaultCredentials = Join-Path $env:USERPROFILE "Keys\webgolfclub-adminsdk.json"
  if (Test-Path $defaultCredentials) {
    $env:GOOGLE_APPLICATION_CREDENTIALS = $defaultCredentials
  }
}

npm --prefix $functionsDir run build

$scriptArgs = @($scriptPath, "--project=$Project")
if ($Execute) {
  $scriptArgs += "--execute"
  $scriptArgs += "--yes-sync-payment-methods"
}

node @scriptArgs
