@echo off
cd /d "C:\Retail\ANYCOMMERCE\local-stack-maintenance"
@echo #
@echo # Starting application, please wait...
@echo #
if not "%wsl__version%0"=="0" (
	@echo # WSL: %wsl__version%
	Powershell -ExecutionPolicy Bypass -File control_center.ps1 -restart wsl
	timeout /t 20 /nobreak > nul
) else if not "%api__version%0"=="0" (
	@echo # API: %api__version%
)
if not "%pos__version%0"=="0" (
	@echo # POS: %pos__version%
) else @echo # POS Lite
@echo #
TASKLIST | find /i "electron-launcher" > nul
if not ERRORLEVEL 1 TASKKILL /IM Electron-Launcher.exe /T /F > nul
timeout /t 2 /nobreak > nul
Start "ELECTRON" "C:\Retail\ANYCOMMERCE\Electron-Launcher\Electron-Launcher.exe" -c "C:\Retail\ANYCOMMERCE\Electron-Launcher\cfg\config.ini"
Powershell -ExecutionPolicy Bypass -File control_center.ps1 -restart apiupdater
timeout /t 30 /nobreak > nul
