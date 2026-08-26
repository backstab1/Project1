@echo off
setlocal
cd /d "%~dp0"
set "PATH=%ProgramFiles%\nodejs;%PATH%"

echo.
echo ==========================================================
echo   CineVault: push schema through the session pooler
echo ==========================================================
echo.
echo   Direct host db.^<ref^>.supabase.co is IPv6 only and is
echo   unreachable from this network. The pooler works over IPv4.
echo.
echo   Where to get the string:
echo     Supabase dashboard - Project Settings - Database -
echo     Connection string - tab "Session pooler" - Copy.
echo.
echo   It looks like this:
echo     postgresql://postgres.REF:PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres
echo.
echo   Replace [YOUR-PASSWORD] with the real password.
echo   Port must be 5432, NOT 6543.
echo.
echo   The string is used only in this window and is not saved.
echo.

set "DBURL="
set /p "DBURL=Connection string: "
if not defined DBURL goto nourl

echo %DBURL% | find "6543" >nul
if not errorlevel 1 (
  echo.
  echo WARNING: port 6543 is the transaction pooler, migrations need 5432.
  echo Press Ctrl+C to abort, or any key to try anyway.
  pause >nul
)

echo.
echo --- Applying migrations ----------------------------------
echo.
call npx.cmd supabase db push --db-url "%DBURL%"
if errorlevel 1 goto failed

echo.
echo ==========================================================
echo   DONE. Go back to the chat.
echo ==========================================================
echo.
pause
exit /b 0

:nourl
echo.
echo Nothing entered. Run this file again.
echo.
pause
exit /b 1

:failed
echo.
echo ==========================================================
echo   FAILED. Copy the text above and send it to the chat,
echo   but REMOVE THE PASSWORD from it first.
echo ==========================================================
echo.
pause
exit /b 1
