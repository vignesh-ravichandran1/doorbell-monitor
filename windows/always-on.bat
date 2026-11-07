@echo off
rem One-time Windows settings for a laptop that records 24/7 while plugged in.
rem Double-click it; it asks for administrator rights. Safe to run again.
net session >nul 2>&1 || (powershell -NoProfile -Command "Start-Process '%~f0' -Verb RunAs" & exit /b)

echo == Power (plugged in): never sleep or hibernate, lid does nothing, disk never spins down, screen off after 1 min
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
powercfg /change disk-timeout-ac 0
powercfg /change monitor-timeout-ac 1
powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0
rem USB selective suspend off, so an external disk on USB never gets switched off
powercfg /setacvalueindex SCHEME_CURRENT 2a737441-1930-4402-8d77-b2bebba308a3 48e6b7a6-50f5-4782-a5d4-53bb8f07e226 0
powercfg /setactive SCHEME_CURRENT

echo == Network adapters: don't let Windows turn them off to save power
powershell -NoProfile -Command "Get-NetAdapter -Physical | ForEach-Object { Set-NetAdapterPowerManagement -Name $_.Name -AllowComputerToTurnOffDevice Disabled -ErrorAction SilentlyContinue }"

echo == Home network set to Private (needed for phones to reach the clips page)
powershell -NoProfile -Command "Get-NetConnectionProfile | Where-Object NetworkCategory -eq 'Public' | Set-NetConnectionProfile -NetworkCategory Private"

echo == Firewall: clips page (port 8080) reachable from home Wi-Fi and Tailscale devices only
netsh advfirewall firewall delete rule name="Doorbell clips page" >nul 2>&1
netsh advfirewall firewall add rule name="Doorbell clips page" dir=in action=allow protocol=TCP localport=8080 remoteip=192.168.0.0/16,10.0.0.0/8,172.16.0.0/12,100.64.0.0/10 profile=any

echo.
echo Done. Still to do by hand (see SETUP.md):
echo   - Automatic sign-in: Win+R, netplwiz
echo   - Windows Update active hours
echo   - Reserve this laptop's IP address in the router
pause
