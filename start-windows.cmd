@echo off
rem Double-click to start ApplyPilot on Windows. The first run installs what it
rem needs and adds an ApplyPilot icon to your desktop and Start menu.
title ApplyPilot
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed.
  echo Opening the download page: install the LTS version, then double-click this file again.
  start "" "https://nodejs.org/en/download"
  pause
  exit /b 1
)
node scripts\launch.mjs
if errorlevel 1 pause
