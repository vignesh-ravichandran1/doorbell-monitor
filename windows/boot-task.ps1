# Run via start-at-boot.bat (needs admin). Makes the recorder start when Windows boots, before
# anyone signs in, so it survives Windows Update restarts and power cuts:
#  - a scheduled task "Doorbell recorder" running windows\start-doorbell.bat as SYSTEM at startup
#    (no password stored; never times out; restarts if it fails; runs on battery too)
#  - removes the old Startup-folder shortcut, so signing in doesn't start a second copy
#  - turns off Fast Startup, which otherwise turns "Shut down" into hibernate, so no real boot
#    happens and the startup task wouldn't run
#  - then (re)starts the recorder through the task
# Remove everything again with:  powershell -ExecutionPolicy Bypass -File windows\boot-task.ps1 -Remove
param([switch]$Remove)
$ErrorActionPreference = 'Stop'
$App = Split-Path -Parent $PSScriptRoot
$Name = 'Doorbell recorder'
$Bat = Join-Path $App 'windows\start-doorbell.bat'
$Shortcut = Join-Path ([Environment]::GetFolderPath('Startup')) 'Doorbell recorder.lnk'
$StopFile = Join-Path $App 'logs\stop-request'

function Ok($m) { Write-Host "  [OK] $m" -ForegroundColor Green }

function Stop-Recorder {
  # Ask a running recorder to stop cleanly (it checks for this file every 2 seconds).
  $running = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -match 'src[\\/]main\.js' }
  if (-not $running) { return }
  New-Item -ItemType Directory -Force (Split-Path $StopFile) | Out-Null
  Set-Content -Path $StopFile -Value 'stop'
  Write-Host '  Stopping the running recorder...'
  for ($i = 0; $i -lt 20 -and (Get-Process -Id $running.ProcessId -ErrorAction SilentlyContinue); $i++) { Start-Sleep 1 }
  Get-Process -Id $running.ProcessId -ErrorAction SilentlyContinue | Stop-Process -Force
  Remove-Item $StopFile -ErrorAction SilentlyContinue
  Ok 'Old recorder stopped'
}

if ($Remove) {
  Stop-Recorder
  if (Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $Name -Confirm:$false
    Ok "Removed the '$Name' task. Start it yourself with windows\start-doorbell.bat."
  }
  exit 0
}

Write-Host "`n== Start the doorbell recorder at boot, without signing in"
$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$Bat`"" -WorkingDirectory $App
$trigger = New-ScheduledTaskTrigger -AtStartup
$trigger.Delay = 'PT30S' # give Wi-Fi a moment after boot
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -StartWhenAvailable -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $Name -Action $action -Trigger $trigger -Principal $principal `
  -Settings $settings -Description 'Records the Ring doorbell (doorbell-monitor). Logs: logs\ in the app folder.' -Force | Out-Null
Ok "Task '$Name' runs at every boot as SYSTEM"

if (Test-Path $Shortcut) { Remove-Item $Shortcut; Ok 'Removed the old start-at-sign-in shortcut' }

Set-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Power' -Name HiberbootEnabled -Value 0 -Type DWord
Ok 'Fast Startup off (shut down + power on is now a real boot)'

Stop-Recorder
Start-ScheduledTask -TaskName $Name
Start-Sleep 5
if (Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'src[\\/]main\.js' }) {
  Ok 'Recorder running in the background (no window). Watch it with windows\watch-log.bat'
} else {
  Write-Host '  [X]  Recorder did not start; see logs\ and Task Scheduler > Doorbell recorder' -ForegroundColor Red
  exit 1
}
