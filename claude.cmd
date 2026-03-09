@echo off
setlocal

REM Repo-local launcher for Claude Code (native preferred).
REM Works even when %USERPROFILE%\.local\bin is not in PATH.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0claude.ps1" %*
exit /b %ERRORLEVEL%

