$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$functionsDir = Join-Path $root 'functions'
$npmCmd = 'C:\Users\kobac\AppData\Roaming\npm\npm.cmd'

if (-not (Test-Path -LiteralPath $npmCmd)) {
  $npmCmd = 'npm'
}

Push-Location $functionsDir
try {
  $env:FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
  $env:FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'
  $env:GCLOUD_PROJECT = 'demo-web-golf-palpala'
  $env:GOOGLE_CLOUD_PROJECT = 'demo-web-golf-palpala'

  if (-not $env:TEST_EMPLOYEE_DEFAULT_PASSWORD) {
    $env:TEST_EMPLOYEE_DEFAULT_PASSWORD = 'Club-Dev-2026'
  }

  & $npmCmd run seed:test-employees
  if ($LASTEXITCODE -ne 0) {
    throw 'Fallo el seed de empleados de prueba.'
  }
}
finally {
  Pop-Location
}
