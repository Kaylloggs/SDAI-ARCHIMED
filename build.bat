@echo off
rem Lanceur double-clic du build SDAI ARCHIMED. Arguments transmis a build.ps1 (ex: build.bat -Bundles all)
setlocal
cd /d "%~dp0"
where pwsh >nul 2>nul
if %ERRORLEVEL%==0 (
  pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0build.ps1" %*
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build.ps1" %*
)
set EXITCODE=%ERRORLEVEL%
echo.
if %EXITCODE% NEQ 0 (echo Build en echec, code %EXITCODE%.) else (echo Build termine.)
pause
exit /b %EXITCODE%
