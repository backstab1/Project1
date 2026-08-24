@echo off
setlocal
cd /d "%~dp0"
set "PATH=%ProgramFiles%\nodejs;%PATH%"

echo.
echo ==========================================================
echo   CineVault: Supabase setup
echo ==========================================================
echo.
echo   Step 1: login       - opens browser, press Authorize
echo   Step 2: project     - paste REFERENCE ID of the dev project
echo   Step 3: link + push - asks for database password
echo.
echo   The password stays in this window.
echo.
pause

echo.
echo --- Step 1: login ----------------------------------------
echo.
call npx.cmd supabase projects list >nul 2>nul
if errorlevel 1 (
  call npx.cmd supabase login
  if errorlevel 1 goto failed
) else (
  echo Already logged in, skipping.
)

echo.
echo --- Step 2: choose project -------------------------------
echo.
call npx.cmd supabase projects list
if errorlevel 1 goto failed
echo.
echo Copy REFERENCE ID of the DEV project from the table above,
echo then paste it here with right mouse click.
echo.
set "REF="
set /p "REF=REFERENCE ID: "
if not defined REF goto noref

echo.
echo --- Step 3: link -----------------------------------------
echo.
call npx.cmd supabase link --project-ref %REF%
if errorlevel 1 goto failed

echo.
echo --- Step 4: push schema ----------------------------------
echo.
call npx.cmd supabase db push
if errorlevel 1 goto failed

echo.
echo ==========================================================
echo   DONE. Go back to the chat.
echo ==========================================================
echo.
pause
exit /b 0

:noref
echo.
echo No REFERENCE ID entered. Run this file again.
echo.
pause
exit /b 1

:failed
echo.
echo ==========================================================
echo   FAILED. Copy the text above and send it to the chat.
echo ==========================================================
echo.
pause
exit /b 1
