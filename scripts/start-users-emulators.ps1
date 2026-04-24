$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$functionsDir = Join-Path $root 'functions'
$firebaseCli = Join-Path $functionsDir 'node_modules\firebase-tools\lib\bin\firebase.js'
$javaHome = 'C:\Program Files\Android\Android Studio\jbr'

if (-not (Test-Path -LiteralPath $javaHome)) {
  throw "No encontramos Java en '$javaHome'."
}

if (-not (Test-Path -LiteralPath $firebaseCli)) {
  throw "No encontramos firebase-tools en '$firebaseCli'."
}

Push-Location $functionsDir
try {
  & npm run build
  if ($LASTEXITCODE -ne 0) {
    throw 'Fallo la compilacion de functions.'
  }
}
finally {
  Pop-Location
}

$env:JAVA_HOME = $javaHome
$env:Path = (Join-Path $javaHome 'bin') + ';' + $env:Path

Push-Location $root
try {
  & node $firebaseCli `
    emulators:start `
    --config firebase.json `
    --project demo-web-golf-palpala `
    --only auth,firestore,functions
}
finally {
  Pop-Location
}
