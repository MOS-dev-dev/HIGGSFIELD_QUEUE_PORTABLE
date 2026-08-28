@echo off
setlocal
set SCRIPT_DIR=%~dp0
echo Starting Chrome CDP on host...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%start-cdp.ps1" %*
set EXIT_CODE=%ERRORLEVEL%
if %EXIT_CODE% NEQ 0 (
    echo [ERROR] start-cdp failed with exit code %EXIT_CODE%
    exit /b %EXIT_CODE%
)
