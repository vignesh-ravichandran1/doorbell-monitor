@echo off
rem Step 1 on Windows: double-click this file.
rem Checks this computer, installs Node.js if needed, installs the app, runs the machine checks.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0windows\prepare.ps1"
pause
