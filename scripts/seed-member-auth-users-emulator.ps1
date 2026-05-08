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
  & $npmCmd run build
  if ($LASTEXITCODE -ne 0) {
    throw 'Fallo la compilacion de functions.'
  }

  $env:FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
  $env:FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'
  $env:GCLOUD_PROJECT = 'demo-web-golf-palpala'
  $env:GOOGLE_CLOUD_PROJECT = 'demo-web-golf-palpala'

  Write-Host 'Verificando emuladores de Firebase...'
  if (-not (Test-TcpPort -HostName '127.0.0.1' -Port 8080)) {
    throw 'Firestore Emulator no responde en 127.0.0.1:8080. Primero ejecuta npm run emulators:start:users en otra terminal.'
  }

  if (-not (Test-TcpPort -HostName '127.0.0.1' -Port 9099)) {
    throw 'Auth Emulator no responde en 127.0.0.1:9099. Primero ejecuta npm run emulators:start:users en otra terminal.'
  }

  if (-not $env:MEMBER_TEMP_PASSWORD_HASH_SECRET) {
    $env:MEMBER_TEMP_PASSWORD_HASH_SECRET = 'club-dev-local-secret'
  }

  Write-Host 'Ejecutando seed de accesos de socios desde members...'
  & node .\lib\scripts\seed-member-auth-users.js
  if ($LASTEXITCODE -ne 0) {
    throw 'Fallo el seed de accesos de socios desde members. Revisa que Auth y Firestore Emulator esten activos.'
  }
}
finally {
  Pop-Location
}
