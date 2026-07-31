param(
  [switch]$Execute,
  [string]$PlanId = "3w7OOgwcQ41ysCWFEoUf",
  [string]$Project = "webgolfclub"
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$functionsDir = Join-Path $root "functions"
$scriptPath = Join-Path $functionsDir "lib\scripts\migrate-installment-plan-to-partial-payments.js"

if (-not $env:GOOGLE_APPLICATION_CREDENTIALS) {
  $defaultCredentials = Join-Path $env:USERPROFILE "Keys\webgolfclub-adminsdk.json"
  if (Test-Path $defaultCredentials) {
    $env:GOOGLE_APPLICATION_CREDENTIALS = $defaultCredentials
  }
}

npm --prefix $functionsDir run build

$scriptArgs = @($scriptPath, "--project=$Project", "--plan-id=$PlanId")
if ($Execute) {
  $scriptArgs += "--execute"
  $scriptArgs += "--yes-partial-payment-migration"
}

node @scriptArgs
