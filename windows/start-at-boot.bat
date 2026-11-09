@echo off
rem Makes the recorder start when Windows boots, without anyone signing in (asks for admin).
rem Run it again any time to restart the recorder.
net session >nul 2>&1
if %errorlevel% neq 0 (
  powershell -NoProfile -Command "Start-Process '%~f0' -Verb RunAs"
  exit /b
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0boot-task.ps1"
echo.
pause
