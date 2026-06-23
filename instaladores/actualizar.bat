@echo off
REM ============================================================
REM  Actualizar mcp-legal-ar - Windows (con git)
REM
REM  Un solo clic: baja los cambios, reinstala dependencias y te
REM  recuerda reiniciar Claude Desktop. Para consumidores que
REM  clonaron el repo con git.
REM
REM  NO es la herramienta de mantenedor (esa es actualizar-repo.bat
REM  en la raiz, que commitea y pushea TUS cambios). Esta solo BAJA.
REM ============================================================
setlocal

REM Raiz del repo = carpeta padre de \instaladores. Se autodetecta.
pushd "%~dp0.."
set "REPO=%CD%"
popd
cd /d "%REPO%"

if not exist "%REPO%\.git" (
  echo No encuentro un repo git en "%REPO%".
  echo Si bajaste el ZIP sin git, usa actualizar-sin-git.bat
  pause
  exit /b 1
)

echo [1/3] Bajando cambios del repositorio...
git pull
if errorlevel 1 (
  echo.
  echo Fallo el git pull. Revisa tu conexion o credenciales con: git remote -v
  pause
  exit /b 1
)

echo [2/3] Reinstalando dependencias...
call npm install
call npm install --prefix servers\legal-mcp

echo [3/3] Listo.
echo.
echo IMPORTANTE: para que Claude tome la version nueva tenes que
echo reiniciar Claude Desktop. Cerralo del todo (boton derecho en el
echo icono de la bandeja, abajo a la derecha, y Salir) y volve a abrirlo.
pause
endlocal
