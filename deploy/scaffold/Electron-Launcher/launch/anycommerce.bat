@echo off
cd /d "C:\Retail\ANYCOMMERCE\local-stack-maintenance"

REM --- Journal des redemarrages de la stack ------------------------------
REM La sortie de control_center.ps1 partait dans la console de demarrage, qui
REM se referme aussitot : quand WSL ou l'apiupdater ne repart pas, il ne restait
REM RIEN a lire sur la caisse. On la garde desormais sur disque.
REM
REM Horodatage calcule par PowerShell plutot que depuis %DATE% : ce dernier suit
REM la locale Windows (une caisse fr-FR rend "jeu. 25/09/2026"), ce qui donnerait
REM des noms de fichiers incoherents d'un pays a l'autre, voire des caracteres
REM interdits dans un nom de fichier.
set "LOG_DIR=C:\Retail\ANYCOMMERCE\logs"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%" > nul 2>&1
for /f %%d in ('Powershell -NoProfile -Command "Get-Date -Format yyyyMMdd"') do set "LOG_DAY=%%d"
set "STACK_LOG=%LOG_DIR%\stack-%LOG_DAY%.log"

REM Retention : 14 jours glissants. forfiles est livre avec Windows. L'echec est
REM avale : une rotation ratee ne doit jamais empecher une caisse de demarrer.
forfiles /p "%LOG_DIR%" /m "stack-*.log" /d -14 /c "cmd /c del @path" > nul 2>&1

@echo #
@echo # Starting application, please wait...
@echo #
if not "%wsl__version%0"=="0" (
	@echo # WSL: %wsl__version%
	>> "%STACK_LOG%" echo ===== %DATE% %TIME% restart wsl %wsl__version% =====
	Powershell -ExecutionPolicy Bypass -File control_center.ps1 -restart wsl >> "%STACK_LOG%" 2>&1
	timeout /t 20 /nobreak > nul
) else if not "%api__version%0"=="0" (
	@echo # API: %api__version%
)
if not "%pos__version%0"=="0" (
	@echo # POS: %pos__version%
) else (
	if not "%sco__version%0"=="0" (
		@echo # SCO: %sco__version%
	) else @echo # POS Lite
)
@echo #
TASKLIST | find /i "electron-launcher" > nul
if not ERRORLEVEL 1 TASKKILL /IM Electron-Launcher.exe /T /F > nul
timeout /t 2 /nobreak > nul
Start "ELECTRON" "C:\Retail\ANYCOMMERCE\Electron-Launcher\Electron-Launcher.exe" -c "C:\Retail\ANYCOMMERCE\Electron-Launcher\cfg\config.ini"
>> "%STACK_LOG%" echo ===== %DATE% %TIME% restart apiupdater =====
Powershell -ExecutionPolicy Bypass -File control_center.ps1 -restart apiupdater >> "%STACK_LOG%" 2>&1
timeout /t 30 /nobreak > nul
