@echo off
REM ============================================================
REM actualizar-repo.bat - mcp-legal-ar
REM 1) Mueve reportes/auditorias sueltos a ..\mcp-legal-ar test
REM    (no se suben al repo; ademas estan en .gitignore)
REM 2) Commitea TODOS los cambios con fecha y hora
REM 3) Pushea al remoto
REM Uso: doble click, o programarlo (ver README seccion "Repo").
REM ============================================================
setlocal enabledelayedexpansion
set "REPO=%~dp0"
set "TESTDIR=%~dp0..\mcp-legal-ar test"

if not exist "%TESTDIR%" mkdir "%TESTDIR%"

echo [1/3] Moviendo reportes a "%TESTDIR%"...
move /Y "%REPO%REPORTE_*.md"  "%TESTDIR%\" >nul 2>&1
move /Y "%REPO%RESUMEN_*.md"  "%TESTDIR%\" >nul 2>&1
move /Y "%REPO%AUDITORIA_*.md" "%TESTDIR%\" >nul 2>&1
move /Y "%REPO%RETEST_*.md"   "%TESTDIR%\" >nul 2>&1

cd /d "%REPO%"

echo [2/3] Commiteando cambios...
git add -A
git diff --cached --quiet
if %errorlevel%==0 (
    echo     Sin cambios nuevos para commitear.
) else (
    for /f "tokens=*" %%d in ('powershell -NoProfile -Command "Get-Date -Format \"yyyy-MM-dd HH:mm\""') do set "FECHA=%%d"
    git commit -m "Actualizacion automatica !FECHA!"
)

echo [3/3] Pusheando al remoto...
git push
if %errorlevel% neq 0 (
    echo.
    echo ATENCION: el push fallo. Revisar remoto/credenciales con: git remote -v
    pause
    exit /b 1
)

echo.
echo Repo actualizado.
timeout /t 5 >nul
