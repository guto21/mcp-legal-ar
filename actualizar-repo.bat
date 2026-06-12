@echo off
REM ============================================================
REM actualizar-repo.bat - mcp-legal-ar
REM 1) Mueve reportes/auditorias sueltos a ..\mcp-legal-ar test
REM    (no se suben al repo; ademas estan en .gitignore)
REM 2) Commitea TODOS los cambios con fecha y hora
REM 3) Pushea al remoto
REM 4) Verifica que los builds esten completos en git (conteo local vs
REM    trackeado). Agregado tras el incidente del 12/06/2026: un push dejo
REM    afuera tls-fallback.js y portalpjn.js y 8 conectores no cargaban
REM    en los clones.
REM Uso: doble click, o programarlo (ver README seccion "Repo").
REM ============================================================
setlocal enabledelayedexpansion
set "REPO=%~dp0"
set "TESTDIR=%~dp0..\mcp-legal-ar test"

if not exist "%TESTDIR%" mkdir "%TESTDIR%"

echo [1/4] Moviendo reportes a "%TESTDIR%"...
move /Y "%REPO%REPORTE_*.md"  "%TESTDIR%\" >nul 2>&1
move /Y "%REPO%RESUMEN_*.md"  "%TESTDIR%\" >nul 2>&1
move /Y "%REPO%AUDITORIA_*.md" "%TESTDIR%\" >nul 2>&1
move /Y "%REPO%RETEST_*.md"   "%TESTDIR%\" >nul 2>&1

cd /d "%REPO%"

echo [2/4] Commiteando cambios...
git add -A
git diff --cached --quiet
if %errorlevel%==0 (
    echo     Sin cambios nuevos para commitear.
) else (
    for /f "tokens=*" %%d in ('powershell -NoProfile -Command "Get-Date -Format \"yyyy-MM-dd HH:mm\""') do set "FECHA=%%d"
    git commit -m "Actualizacion automatica !FECHA!"
)

echo [3/4] Pusheando al remoto...
git push
if %errorlevel% neq 0 (
    echo.
    echo ATENCION: el push fallo. Revisar remoto/credenciales con: git remote -v
    pause
    exit /b 1
)

echo [4/4] Verificando integridad de los builds en git...
set "FALTAN=0"

for /f %%c in ('dir /s /b /a-d "%REPO%servers\legal-mcp\build\*.js" 2^>nul ^| find /c /v ""') do set "LOCAL1=%%c"
for /f %%c in ('git ls-files "servers/legal-mcp/build/*.js" ^| find /c /v ""') do set "TRACK1=%%c"
if not "!LOCAL1!"=="!TRACK1!" (
    echo     ATENCION: servers\legal-mcp\build tiene !LOCAL1! .js locales pero !TRACK1! trackeados.
    echo     Sin trackear:
    git ls-files --others --exclude-standard "servers/legal-mcp/build"
    set "FALTAN=1"
)

for /f %%c in ('dir /s /b /a-d "%REPO%servers\saij-mcp\build\*.js" 2^>nul ^| find /c /v ""') do set "LOCAL2=%%c"
for /f %%c in ('git ls-files "servers/saij-mcp/build/*.js" ^| find /c /v ""') do set "TRACK2=%%c"
if not "!LOCAL2!"=="!TRACK2!" (
    echo     ATENCION: servers\saij-mcp\build tiene !LOCAL2! .js locales pero !TRACK2! trackeados.
    echo     Sin trackear:
    git ls-files --others --exclude-standard "servers/saij-mcp/build"
    set "FALTAN=1"
)

if "!FALTAN!"=="1" (
    echo.
    echo PUSH INCOMPLETO POSIBLE: hay archivos del build fuera de git.
    echo Correr: git add -A ^&^& git commit -m "archivos faltantes" ^&^& git push
    pause
    exit /b 1
)
echo     Builds completos: legal-mcp !LOCAL1!/!TRACK1! - saij-mcp !LOCAL2!/!TRACK2!

echo.
echo Repo actualizado.
timeout /t 5 >nul
