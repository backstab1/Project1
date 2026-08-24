@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0"
set "PATH=%ProgramFiles%\nodejs;%PATH%"

echo.
echo ==========================================================
echo   CineVault: подключение к Supabase
echo ==========================================================
echo.
echo   Скрипт делает три вещи:
echo     1) вход в Supabase CLI  - откроется браузер;
echo     2) привязка к проекту   - спросит пароль базы;
echo     3) накат схемы          - пять миграций.
echo.
echo   Пароль базы вводится здесь, в вашем окне, и остаётся у вас.
echo.
pause

echo.
echo --- 1. Вход ----------------------------------------------
echo.
call npx.cmd supabase projects list >nul 2>&1
if errorlevel 1 (
  call npx.cmd supabase login
  if errorlevel 1 goto :failed
) else (
  echo Вход уже выполнен, пропускаю.
)

echo.
echo --- 2. Выбор проекта -------------------------------------
echo.
call npx.cmd supabase projects list
echo.
echo Скопируйте REFERENCE ID нужного проекта ^(столбец REFERENCE ID^)
echo и вставьте сюда правой кнопкой мыши.
echo.
set "REF="
set /p "REF=REFERENCE ID dev-проекта: "
if "%REF%"=="" goto :noref

echo.
echo --- 3. Привязка ------------------------------------------
echo.
call npx.cmd supabase link --project-ref %REF%
if errorlevel 1 goto :failed

echo.
echo --- 4. Схема ---------------------------------------------
echo.
call npx.cmd supabase db push
if errorlevel 1 goto :failed

echo.
echo ==========================================================
echo   Готово. Возвращайтесь в чат — дальше я сам.
echo ==========================================================
echo.
pause
exit /b 0

:noref
echo.
echo REFERENCE ID не введён. Запустите файл ещё раз.
echo.
pause
exit /b 1

:failed
echo.
echo ==========================================================
echo   Команда завершилась с ошибкой.
echo   Скопируйте текст выше и пришлите мне в чат.
echo ==========================================================
echo.
pause
exit /b 1
