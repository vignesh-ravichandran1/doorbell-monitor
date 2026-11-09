@echo off
rem Shows the recorder's log live (the recorder runs in the background without a window).
rem Closing this window does NOT stop the recorder.
cd /d "%~dp0.."
title Doorbell recorder log
powershell -NoProfile -Command "$f = Get-ChildItem logs\recorder-*.log | Sort-Object Name | Select-Object -Last 1; if (-not $f) { 'No log yet.'; exit }; Get-Content $f.FullName -Tail 60 -Wait"
