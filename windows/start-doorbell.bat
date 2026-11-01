@echo off
rem Starts the doorbell recorder and restarts it if it ever stops.
cd /d "%~dp0.."
:loop
echo Starting doorbell recorder...
call npm start
echo Stopped. Restarting in 10 seconds (close this window to quit).
timeout /t 10 /nobreak >nul
goto loop
