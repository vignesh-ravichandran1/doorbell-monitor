@echo off
rem Stops the background recorder cleanly (it starts again at the next boot).
rem To start it again now, run start-at-boot.bat.
cd /d "%~dp0.."
if not exist logs mkdir logs
echo stop> logs\stop-request
echo Asked the recorder to stop. It stops within a few seconds.
ping -n 6 127.0.0.1 >nul
