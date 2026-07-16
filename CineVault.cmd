@echo off
setlocal
cd /d "%~dp0"

where py >nul 2>nul
if %errorlevel%==0 (
    py -3 launch.py
    goto :end
)

where python >nul 2>nul
if %errorlevel%==0 (
    python launch.py
    goto :end
)

echo.
echo CineVault needs Python 3 to start.
echo Install Python from https://www.python.org/downloads/windows/
echo and enable "Add Python to PATH".
echo.
pause

:end
endlocal

