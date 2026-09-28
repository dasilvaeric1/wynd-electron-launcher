# no_quickedit.ps1 : coupe le mode "edition rapide" (QuickEdit) de la
# console qui l'appelle, pour toute sa duree de vie.
#
# Appele par anycommerce.bat. En edition rapide, un simple clic dans la
# fenetre demarre une selection, et Windows SUSPEND alors tout processus qui
# ecrit dans cette console, jusqu'a Entree ou Echap. Sur une caisse, cela
# figeait control_center.ps1 : le Retail Scheduler, qui le voit tourner,
# suspendait taches et commandes a distance (maintenance) pendant des heures.
#
# Le mode appartient a la console, pas au processus : le changer ici vaut pour
# le .bat et pour tout ce qu'il lance ensuite dans la meme fenetre.
#
# Ne doit JAMAIS empecher une caisse de demarrer : toute erreur est avalee
# (pas de console, Add-Type interdit par une strategie, hors Windows...).

try {
    $signatures = @'
[DllImport("kernel32.dll", SetLastError = true)]
public static extern IntPtr GetStdHandle(int nStdHandle);
[DllImport("kernel32.dll", SetLastError = true)]
public static extern bool GetConsoleMode(IntPtr hConsoleHandle, out uint lpMode);
[DllImport("kernel32.dll", SetLastError = true)]
public static extern bool SetConsoleMode(IntPtr hConsoleHandle, uint dwMode);
'@
    $console = Add-Type -MemberDefinition $signatures -Name ConsoleMode -Namespace AnyCommerce -PassThru

    $STD_INPUT_HANDLE = -10
    $ENABLE_QUICK_EDIT_MODE = 0x0040
    # Obligatoire : sans lui, Windows ignore tout changement de QuickEdit.
    $ENABLE_EXTENDED_FLAGS = 0x0080

    $handle = $console::GetStdHandle($STD_INPUT_HANDLE)
    $mode = [uint32]0
    if ($console::GetConsoleMode($handle, [ref]$mode)) {
        $nouveau = [uint32](($mode -bor $ENABLE_EXTENDED_FLAGS) -band (-bnot $ENABLE_QUICK_EDIT_MODE))
        [void]$console::SetConsoleMode($handle, $nouveau)
    }
} catch {
    # Rien : sans QuickEdit coupe, la caisse demarre comme avant.
}
exit 0
