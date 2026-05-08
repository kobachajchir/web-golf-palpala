$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$functionsDir = Join-Path $root 'functions'
$npmCmd = 'C:\Users\kobac\AppData\Roaming\npm\npm.cmd'

if (-not (Test-Path -LiteralPath $npmCmd)) {
  $npmCmd = 'npm'
}

Push-Location $functionsDir
try {
  & $npmCmd run build
  if ($LASTEXITCODE -ne 0) {
    throw 'Fallo la compilacion de functions.'
  }

  $env:FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
  $env:GCLOUD_PROJECT = 'demo-web-golf-palpala'
  $env:GOOGLE_CLOUD_PROJECT = 'demo-web-golf-palpala'

  & node .\lib\scripts\import-palpala-members.js
  if ($LASTEXITCODE -ne 0) {
    throw 'Fallo la importacion del padron al Firestore Emulator.'
  }
}
finally {
  Pop-Location
}
