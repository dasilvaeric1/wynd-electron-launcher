<#
create-test-shortcut.ps1 : met start.ps1 a l'essai sur une caisse, sans rien
casser du lancement actuel (anycommerce.bat, raccourci ChapsPOS.lnk).

  create-test-shortcut.ps1            raccourci "Octipas POS (nouveau demarrage)"
                                      sur le bureau : a lancer a la main, launcher
                                      ferme, pour comparer avec l'ancien.
  create-test-shortcut.ps1 -Startup   essai a l'ouverture de session : le nouveau
                                      raccourci va dans le dossier Demarrage et
                                      ChapsPOS.lnk est renomme ChapsPOS.lnk.desactive
                                      (les deux ne doivent jamais partir ensemble :
                                      l'ancien .bat tue le launcher qu'il trouve).
  create-test-shortcut.ps1 -Restore   remet exactement l'etat d'origine.

A lancer dans la session du caissier (le bureau et le dossier Demarrage sont
les siens), sans droits administrateur.
#>
param(
    [switch]$Startup,
    [switch]$Restore
)
$ErrorActionPreference = 'Stop'

$Nom = 'Octipas POS (nouveau démarrage).lnk'
$Bureau = [Environment]::GetFolderPath('Desktop')
$Demarrage = [Environment]::GetFolderPath('Startup')
$Ancien = Join-Path $Demarrage 'ChapsPOS.lnk'
$AncienDesactive = "$Ancien.desactive"

function New-Raccourci([string]$dossier) {
    $powershell = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $chemin = Join-Path $dossier $Nom
    $lnk = (New-Object -ComObject WScript.Shell).CreateShortcut($chemin)
    $lnk.TargetPath = $powershell
    $lnk.Arguments = ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}"' -f (Join-Path $PSScriptRoot 'start.ps1'))
    $lnk.WorkingDirectory = $PSScriptRoot
    # 7 = reduite : la console de powershell.exe, deja cachee par
    # -WindowStyle Hidden, ne clignote meme pas au premier plan.
    $lnk.WindowStyle = 7
    $ico = Join-Path $PSScriptRoot 'logo.ico'
    if (Test-Path -LiteralPath $ico) { $lnk.IconLocation = $ico }
    $lnk.Description = 'Lancement de la caisse avec écran de chargement (essai)'
    $lnk.Save()
    Write-Output "Raccourci créé : $chemin"
}

if ($Restore) {
    foreach ($p in @((Join-Path $Demarrage $Nom), (Join-Path $Bureau $Nom))) {
        if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Force; Write-Output "Supprimé : $p" }
    }
    if ((Test-Path -LiteralPath $AncienDesactive) -and -not (Test-Path -LiteralPath $Ancien)) {
        Rename-Item -LiteralPath $AncienDesactive -NewName 'ChapsPOS.lnk'
        Write-Output "Rétabli : $Ancien"
    }
    Write-Output 'Lancement d''origine rétabli (anycommerce.bat).'
    exit 0
}

if ($Startup) {
    New-Raccourci $Demarrage
    if (Test-Path -LiteralPath $Ancien) {
        Rename-Item -LiteralPath $Ancien -NewName 'ChapsPOS.lnk.desactive'
        Write-Output "Désactivé (réversible avec -Restore) : $Ancien"
    } else {
        Write-Output "Attention : $Ancien introuvable. Vérifier qu'aucun autre lancement de la caisse n'a lieu à l'ouverture de session."
    }
    Write-Output 'Au prochain démarrage de session, la caisse se lancera avec start.ps1.'
    exit 0
}

New-Raccourci $Bureau
Write-Output 'Pour comparer : fermer le launcher, puis double-cliquer ce raccourci.'
