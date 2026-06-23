@echo off
REM ============================================================
REM  Actualizar mcp-legal-ar - Windows (SIN git)
REM
REM  Para consumidores que bajaron el ZIP y no usan git. Re-descarga
REM  la ultima version, reinstala dependencias y avisa de reiniciar.
REM  Lanza el .ps1 (que se carga en memoria y por eso puede
REM  sobrescribirse a si mismo sin romperse durante la descarga).
REM ============================================================
powershell -ExecutionPolicy Bypass -File "%~dp0_actualizar-sin-git.ps1"
pause
