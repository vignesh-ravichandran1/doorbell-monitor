@echo off
rem Starts the doorbell recorder and restarts it if it ever stops.
rem Run at boot by the "Doorbell recorder" task (see start-at-boot.bat); you can also double-click it.
cd /d "%~dp0.."
rem Tells the recorder this loop restarts it, so updates from the Settings page can restart it.
set DOORBELL_SUPERVISED=1
:loop
rem Undo an update from the Settings page that keeps failing to start.
node src\update-guard.js
echo Starting doorbell recorder...
node src\main.js
rem 3 = stopped on purpose (stop-recorder.bat) or already running: don't restart
if %errorlevel% equ 3 exit /b 0
echo Stopped. Restarting in 10 seconds (close this window to quit).
ping -n 11 127.0.0.1 >nul
goto loop
