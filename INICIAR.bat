@echo off
title AI Platform - Iniciando...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\iniciar-sistema.ps1"
echo.
echo Pressione qualquer tecla para fechar esta janela (o sistema continua rodando).
pause >nul
