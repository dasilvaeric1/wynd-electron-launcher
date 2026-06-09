@echo off
@echo #
@echo # Starting application, please wait...
@echo #
if not "%wsl__version%0"=="0" (
	@echo # WSL: %wsl__version%
	Powershell -ExecutionPolicy Bypass -File control_center.ps1 -restart wsl
	timeout /t 20 /nobreak > null
) else if not "%api__version%0"=="0" (
	@echo # API: %api__version%
)
if not "%pos__version%0"=="0" (
	@echo # POS: %pos__version%
) else @echo # POS Lite
@echo #
TASKLIST | find /i "electron-launcher" > null
if not ERRORLEVEL 1 TASKKILL /IM Electron-Launcher.exe /T /F > null
timeout /t 2 /nobreak > null
Start "ELECTRON" "C:\Retail\ANYCOMMERCE\Electron-Launcher\Electron-Launcher.exe" -c "C:\Retail\ANYCOMMERCE\Electron-Launcher\cfg\config.ini"
cd "C:\Retail\ANYCOMMERCE\local-stack-maintenance" 
Powershell -ExecutionPolicy Bypass -File control_center.ps1 -restart apiupdater
timeout /t 30 /nobreak > null
