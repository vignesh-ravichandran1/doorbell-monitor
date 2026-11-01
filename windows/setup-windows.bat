@echo off
rem One-time setup for an always-on Windows 10/11 laptop. Run it by double-clicking.
cd /d "%~dp0.."

echo == Never sleep on mains power, keep running with the lid closed, screen off after 1 minute
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
powercfg /change monitor-timeout-ac 1
powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0
powercfg /setactive SCHEME_CURRENT

echo == Start the recorder automatically when you sign in
powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Startup')+'\Doorbell recorder.lnk'); $s.TargetPath='%~dp0start-doorbell.bat'; $s.WorkingDirectory='%~dp0..'; $s.WindowStyle=7; $s.Save()"

echo == Installing app dependencies
call npm install

echo.
echo Done. Next: run "npm run login" in this folder, put the token in .env, then double-click windows\start-doorbell.bat
pause
