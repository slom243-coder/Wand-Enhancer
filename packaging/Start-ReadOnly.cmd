@echo off
setlocal
set "WAND_REMOTE_READ_ONLY=1"
if not exist "%~dp0WandEnhancer.exe" (
    echo WandEnhancer.exe is missing. Build or download the Windows artifact first.
    pause
    exit /b 1
)
start "" /wait "%~dp0WandEnhancer.exe"
