@echo off
title AI Platform - Parando...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\parar-sistema.ps1"
echo.
pause >nul
