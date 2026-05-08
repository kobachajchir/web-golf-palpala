$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$functionsDir = Join-Path $root 'functions'

Push-Location $functionsDir
try {
  & npm run build
  if ($LASTEXITCODE -ne 0) {
    throw 'Fallo la compilacion de functions.'
  }

  $env:FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
  $env:GCLOUD_PROJECT = 'demo-web-golf-palpala'
  $env:GOOGLE_CLOUD_PROJECT = 'demo-web-golf-palpala'

  & node .\lib\scripts\seed-accounting.js
  if ($LASTEXITCODE -ne 0) {
    throw 'Fallo el seed de ACCOUNTING en el Firestore Emulator.'
  }
}
finally {
  Pop-Location
}
