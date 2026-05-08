$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$functionsDir = Join-Path $root 'functions'
$npmCmd = 'C:\Users\kobac\AppData\Roaming\npm\npm.cmd'

function Test-TcpPort {
  param(
    [Parameter(Mandatory = $true)]
    [string]$HostName,
    [Parameter(Mandatory = $true)]
    [int]$Port,
    [int]$TimeoutMs = 1500
  )

  $client = [System.Net.Sockets.TcpClient]::new()
  try {
    $asyncResult = $client.BeginConnect($HostName, $Port, $null, $null)
    if (-not $asyncResult.AsyncWaitHandle.WaitOne($TimeoutMs, $false)) {
      return $false
    }

    $client.EndConnect($asyncResult)
    return $true
  }
  catch {
    return $false
  }
  finally {
    $client.Close()
  }
}

if (-not (Test-Path -LiteralPath $npmCmd)) {
  $npmCmd = 'npm'
}

Push-Location $functionsDir
try {
  Write-Host '[1/9] Compilando Functions...'
  & $npmCmd run build
  if ($LASTEXITCODE -ne 0) {
    throw 'Fallo la compilacion de functions.'
  }

  $env:FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
  $env:FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'
  $env:GCLOUD_PROJECT = 'demo-web-golf-palpala'
  $env:GOOGLE_CLOUD_PROJECT = 'demo-web-golf-palpala'

  Write-Host '[2/9] Verificando emuladores de Firebase...'
  if (-not (Test-TcpPort -HostName '127.0.0.1' -Port 8080)) {
    throw 'Firestore Emulator no responde en 127.0.0.1:8080. Primero ejecuta npm run emulators:start:users en otra terminal.'
  }

  if (-not (Test-TcpPort -HostName '127.0.0.1' -Port 9099)) {
    throw 'Auth Emulator no responde en 127.0.0.1:9099. Primero ejecuta npm run emulators:start:users en otra terminal.'
  }

  if (-not $env:MEMBER_TEMP_PASSWORD_HASH_SECRET) {
    $env:MEMBER_TEMP_PASSWORD_HASH_SECRET = 'club-dev-local-secret'
  }

  Write-Host '[3/9] Sembrando configuracion contable base...'
  & node .\lib\scripts\seed-accounting.js
  if ($LASTEXITCODE -ne 0) {
    throw 'Fallo el seed de configuracion contable.'
  }

  Write-Host '[4/9] Importando padron, IDs unicos y grupos familiares...'
  & node .\lib\scripts\import-palpala-members.js
  if ($LASTEXITCODE -ne 0) {
    throw 'Fallo la importacion del padron al Firestore Emulator.'
  }

  Write-Host '[5/9] Verificando vinculos familiares solicitados...'
  & node .\lib\scripts\seed-requested-family-groups.js
  if ($LASTEXITCODE -ne 0) {
    throw 'Fallo el seed de grupos familiares solicitados.'
  }

  Write-Host '[6/9] Creando o sincronizando accesos Auth de socios...'
  & node .\lib\scripts\seed-member-auth-users.js
  if ($LASTEXITCODE -ne 0) {
    throw 'Fallo el seed de accesos de socios desde members.'
  }

  if (-not $env:TEST_EMPLOYEE_DEFAULT_PASSWORD) {
    $env:TEST_EMPLOYEE_DEFAULT_PASSWORD = 'Club-Dev-2026'
  }

  Write-Host '[7/9] Creando empleados de prueba...'
  & node .\lib\scripts\seed-test-employees.js
  if ($LASTEXITCODE -ne 0) {
    throw 'Fallo el seed de empleados de prueba.'
  }

  if (-not $env:EXECUTIVE_BOARD_DEFAULT_PASSWORD) {
    $env:EXECUTIVE_BOARD_DEFAULT_PASSWORD = 'Club-Dev-2026'
  }

  Write-Host '[8/9] Creando o actualizando usuarios de Junta Directiva...'
  & node .\lib\scripts\seed-executive-board.js
  if ($LASTEXITCODE -ne 0) {
    throw 'Fallo el seed de la comision directiva.'
  }

  if (-not $env:DEV_DIRECTIVO_PASSWORD) {
    $env:DEV_DIRECTIVO_PASSWORD = 'Club-Dev-2026'
  }

  Write-Host '[9/9] Creando o actualizando usuario dev 999 Koba Chajchir...'
  & node .\lib\scripts\seed-dev-directivo.js
  if ($LASTEXITCODE -ne 0) {
    throw 'Fallo el seed del usuario dev directivo.'
  }

  Write-Host 'Seed completo finalizado correctamente.'
}
finally {
  Pop-Location
}
