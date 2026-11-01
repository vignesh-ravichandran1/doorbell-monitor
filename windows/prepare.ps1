# Run via prepare.bat. Checks this computer, installs Node.js 22 LTS if it's missing or too old,
# installs the app's dependencies (including ffmpeg), then runs the machine checks.
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)

function Say($m)  { Write-Host "`n== $m" -ForegroundColor White }
function Ok($m)   { Write-Host "  [OK] $m" -ForegroundColor Green }
function Fail($m) { Write-Host "  [X]  $m" -ForegroundColor Red; exit 1 }

$NodeMin  = 22
$NodeDist = 'https://nodejs.org/dist/latest-v22.x'

Say 'Checking this computer'
$v = [Environment]::OSVersion.Version
if ($v.Major -lt 10) {
  Fail "Windows $($v.Major).$($v.Minor) (Windows 7/8) is too old. Needs Windows 10 or 11, or install a free light Linux such as Linux Mint XFCE."
}
if (-not [Environment]::Is64BitOperatingSystem) {
  Fail '32-bit Windows is not supported. Needs 64-bit Windows 10/11, or install a free 64-bit Linux.'
}
Ok "Windows (build $($v.Build), 64-bit)"

function Get-NodeMajor {
  try { [int]((& node -v) -replace '^v(\d+).*', '$1') } catch { 0 }
}
function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}

Say 'Node.js'
$major = Get-NodeMajor
if ($major -ge $NodeMin) {
  Ok "Node.js $(node -v) already installed"
} else {
  if ($major -gt 0) { Write-Host "  Node.js $(node -v) is too old, installing Node.js 22 LTS" }
  else { Write-Host '  Node.js not found, installing Node.js 22 LTS' }

  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $ProgressPreference = 'SilentlyContinue'  # makes downloads much faster on old PowerShell
  try {
    $sums = (Invoke-WebRequest -UseBasicParsing "$NodeDist/SHASUMS256.txt").Content -split "`n"
  } catch { Fail "Can't download Node.js. Check the internet connection." }
  $line = $sums | Where-Object { $_ -match 'node-v[\d.]+-x64\.msi$' } | Select-Object -First 1
  if (-not $line) { Fail "Couldn't find the Node.js download." }
  $want, $file = ($line.Trim() -split '\s+')
  $msi = Join-Path $env:TEMP $file
  Write-Host "  Downloading $file ..."
  Invoke-WebRequest -UseBasicParsing "$NodeDist/$file" -OutFile $msi
  if ((Get-FileHash $msi -Algorithm SHA256).Hash.ToLower() -ne $want.ToLower()) {
    Fail 'Download is corrupted (checksum mismatch). Run this again.'
  }
  Ok 'Download verified'
  Write-Host '  Installing (Windows will ask for permission) ...'
  $p = Start-Process msiexec.exe -ArgumentList '/i', "`"$msi`"", '/passive', '/norestart' -Wait -PassThru
  if ($p.ExitCode -ne 0) { Fail "Node.js install failed (code $($p.ExitCode))." }
  Remove-Item $msi -ErrorAction SilentlyContinue
  Refresh-Path
  if ((Get-NodeMajor) -lt $NodeMin) { Fail 'Node.js still not available. Close this window and double-click prepare.bat again.' }
  Ok "Node.js $(node -v) installed"
}

Say 'Installing the app (downloads ffmpeg too, ~1 minute)'
& npm.cmd install --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { Fail 'npm install failed. Check the internet connection and run this again.' }
Ok 'App installed'

Say 'Machine checks'
& node src/doctor.js --pre
if ($LASTEXITCODE -ne 0) { Fail 'Fix the [X] items above, then double-click prepare.bat again.' }

Write-Host "`nReady. Next step: open a Command Prompt in this folder and run:  npm run setup`n" -ForegroundColor Green
