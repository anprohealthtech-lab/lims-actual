@echo off
setlocal

net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Requesting administrator permissions...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-qz-tray-trust.ps1"
pause
