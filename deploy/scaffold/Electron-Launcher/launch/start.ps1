<#
start.ps1 : lanceur de caisse avec ecran de chargement immediat.

A l'essai, EN PARALLELE d'anycommerce.bat (qui reste le lancement par defaut).
Meme sequence que le .bat, dans le meme ordre :
  1. si WSL est configure : control_center.ps1 -restart wsl, puis 20 s d'attente ;
  2. lancement d'Electron-Launcher ;
  3. control_center.ps1 -restart apiupdater (en parallele de l'ouverture).

Ce qui change :
  - un ecran de chargement s'affiche en 1 a 2 s, a la place d'un ecran vide ou
    d'une console. Il s'efface quand la fenetre du launcher apparait, sa mire
    prenant le relais au meme endroit, a la meme taille ;
  - aucune console : control_center.ps1 tourne cache, sa sortie part dans
    logs\stack-AAAAMMJJ.log. Plus de clic qui fige la caisse (QuickEdit) ;
  - un launcher deja ouvert n'est plus tue : il revient au premier plan ;
  - les durees sont notees au journal, pour comparer avec l'ancien lancement.

Lancement (raccourci, voir create-test-shortcut.ps1) :
  powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File start.ps1

Ecrit pour Windows PowerShell 5.1. Les parametres autres que les chemins ne
servent qu'aux tests (__tests__/launch_start.test.js, avec pwsh hors Windows).
Regle d'or : quoi qu'il arrive, la caisse doit se lancer.
#>
param(
    [string]$Root = 'C:\Retail\ANYCOMMERCE',
    [string]$MaintenanceDir = '',
    [string]$LogDir = '',
    [string]$LauncherExe = '',
    [string]$LauncherConfig = '',
    [string]$LauncherProcessName = 'electron-launcher',
    [string]$PowerShellExe = 'powershell.exe',
    [int]$WslWaitSeconds = 20,
    [int]$HandoffTimeoutSeconds = 90,
    [switch]$NoSplash
)

$ErrorActionPreference = 'Stop'
if (-not $MaintenanceDir) { $MaintenanceDir = Join-Path $Root 'local-stack-maintenance' }
if (-not $LogDir) { $LogDir = Join-Path $Root 'logs' }
if (-not $LauncherExe) { $LauncherExe = Join-Path $Root 'Electron-Launcher\Electron-Launcher.exe' }
if (-not $LauncherConfig) { $LauncherConfig = Join-Path $Root 'Electron-Launcher\cfg\config.ini' }

# --------------------------------------------------------------- journal
# Meme fichier que le .bat (logs\stack-AAAAMMJJ.log), meme retention (14 j).
# Lignes en ASCII : le .bat y ecrit aussi, dans la page de code de la console.
try { New-Item -ItemType Directory -Force -Path $LogDir | Out-Null } catch { }
$LogFile = Join-Path $LogDir ('stack-{0}.log' -f (Get-Date -Format 'yyyyMMdd'))
try {
    Get-ChildItem -Path $LogDir -Filter 'stack-*.log' |
        Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-14) } |
        Remove-Item -Force
} catch { }

function Write-Journal([string]$Message) {
    try { Add-Content -LiteralPath $LogFile -Value $Message -Encoding ASCII } catch { }
}
function Get-Horodatage { Get-Date -Format 'yyyy-MM-dd HH:mm:ss' }

$OnWindows = ($env:OS -eq 'Windows_NT')
$Debut = [DateTime]::Now

# Etat partage entre l'orchestration (runspace) et l'ecran (thread principal).
$state = [hashtable]::Synchronized(@{
    Phases          = @()
    PhaseState      = @{}
    Current         = 0
    Detail          = ''
    Sub             = 'DÉMARRAGE DE LA CAISSE'
    SlowAt          = $null
    HandedOff       = $false
    LauncherStarted = $false
})
$Labels = @{
    services = 'Services de la caisse'
    launch   = "Lancement de l'application"
    open     = 'Caisse déjà ouverte'
}
$cfg = @{
    LogFile          = $LogFile
    MaintenanceDir   = $MaintenanceDir
    LauncherExe      = $LauncherExe
    LauncherConfig   = $LauncherConfig
    ProcName         = $LauncherProcessName
    PowerShellExe    = $PowerShellExe
    WslVersion       = [string]$env:wsl__version
    WslWait          = $WslWaitSeconds
    HandoffTimeout   = $HandoffTimeoutSeconds
    OnWindows        = $OnWindows
    Debut            = $Debut
    Ui               = $false
}

# ---------------------------------------------------------- orchestration
# Scriptblock autonome (execute dans un runspace a part quand l'ecran est
# affiche) : il ne voit rien du script appelant, d'ou ses propres fonctions.
$orchestrate = {
    param($s, $cfg)
    $ErrorActionPreference = 'Stop'

    function Log([string]$m) { try { Add-Content -LiteralPath $cfg.LogFile -Value $m -Encoding ASCII } catch { } }
    function Stamp { Get-Date -Format 'yyyy-MM-dd HH:mm:ss' }
    function Since { ([math]::Round(([DateTime]::Now - $cfg.Debut).TotalSeconds, 1)).ToString([Globalization.CultureInfo]::InvariantCulture) }

    # Sortie brute du processus ajoutee au journal, octet pour octet : elle est
    # dans la page de code de control_center.ps1, on ne la reencode pas.
    function Add-Output([string]$path) {
        if (-not (Test-Path -LiteralPath $path)) { return }
        try {
            $bytes = [IO.File]::ReadAllBytes($path)
            if ($bytes.Length -gt 0) {
                $fs = [IO.File]::Open($cfg.LogFile, 'Append', 'Write', 'ReadWrite')
                try { $fs.Write($bytes, 0, $bytes.Length) } finally { $fs.Close() }
            }
        } catch { }
        Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
    }

    # control_center.ps1 comme le .bat (meme ligne de commande : le Retail
    # Scheduler la reconnait et suspend ses taches), mais cache et redirige.
    function Start-ControlCenter([string]$action) {
        $out = [IO.Path]::GetTempFileName()
        $err = [IO.Path]::GetTempFileName()
        $opts = @{
            FilePath               = $cfg.PowerShellExe
            ArgumentList           = @('-ExecutionPolicy', 'Bypass', '-File', 'control_center.ps1', '-restart', $action)
            WorkingDirectory       = $cfg.MaintenanceDir
            RedirectStandardOutput = $out
            RedirectStandardError  = $err
            PassThru               = $true
        }
        if ($cfg.OnWindows) { $opts.WindowStyle = 'Hidden' }
        $p = Start-Process @opts
        # Sans cet acces au handle, Windows PowerShell 5.1 perd l'ExitCode.
        $null = $p.Handle
        return @{ Process = $p; Out = $out; Err = $err; Action = $action }
    }
    function Wait-ControlCenter($run) {
        $run.Process.WaitForExit()
        Add-Output $run.Out
        Add-Output $run.Err
        $code = $run.Process.ExitCode
        if ($code -ne 0) { Log ('[start.ps1] restart {0} en echec (code {1})' -f $run.Action, $code) }
        return $code
    }

    $apiupdater = $null
    try {
        Log ('versions : wsl={0} api={1} pos={2} sco={3}' -f $env:wsl__version, $env:api__version, $env:pos__version, $env:sco__version)

        # 1. WSL
        if ($cfg.WslVersion) {
            $s.PhaseState['services'] = 'active'
            $s.Detail = 'control_center.ps1 -restart wsl'
            $s.SlowAt = [DateTime]::Now.AddSeconds(45)
            Log ('===== {0} [start.ps1] restart wsl {1} =====' -f (Stamp), $cfg.WslVersion)
            $code = Wait-ControlCenter (Start-ControlCenter 'wsl')
            if ($cfg.WslWait -gt 0) {
                $s.SlowAt = $null
                $s.Detail = ('Attente du démarrage de WSL ({0} s)' -f $cfg.WslWait)
                Start-Sleep -Seconds $cfg.WslWait
            }
            if ($code -eq 0) { $s.PhaseState['services'] = 'done' } else { $s.PhaseState['services'] = 'failed' }
            $s.Current = 1
        }

        # 2. Launcher
        $s.PhaseState['launch'] = 'active'
        $s.Detail = 'Electron-Launcher.exe'
        $s.SlowAt = [DateTime]::Now.AddSeconds(30)
        Start-Process -FilePath $cfg.LauncherExe -ArgumentList @('-c', ('"{0}"' -f $cfg.LauncherConfig)) -WorkingDirectory $cfg.MaintenanceDir | Out-Null
        $s.LauncherStarted = $true
        Log ('[start.ps1] launcher lance a +{0} s' -f (Since))

        # 3. apiupdater, comme le .bat : juste apres le lancement, en parallele.
        Log ('===== {0} [start.ps1] restart apiupdater =====' -f (Stamp))
        $apiupdater = Start-ControlCenter 'apiupdater'

        # Relais a la mire du launcher : l'ecran reste tant qu'aucune fenetre
        # du launcher n'est visible (decompression du build portable...).
        if ($cfg.Ui) {
            $s.Detail = 'Ouverture de la caisse…'
            $limite = [DateTime]::Now.AddSeconds($cfg.HandoffTimeout)
            $visible = $false
            while ([DateTime]::Now -lt $limite) {
                $w = Get-Process -Name $cfg.ProcName -ErrorAction SilentlyContinue |
                    Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero }
                if ($w) { $visible = $true; break }
                Start-Sleep -Milliseconds 250
            }
            if ($visible) { Log ('[start.ps1] launcher visible a +{0} s' -f (Since)) }
            else { Log ('[start.ps1] launcher toujours invisible apres {0} s : ecran retire' -f $cfg.HandoffTimeout) }
        }
        $s.PhaseState['launch'] = 'done'
        $s.HandedOff = $true

        [void](Wait-ControlCenter $apiupdater)
    } catch {
        Log ('[start.ps1] erreur inattendue : {0}' -f $_.Exception.Message)
        throw
    } finally {
        $s.HandedOff = $true
        Log ('[start.ps1] termine en {0} s' -f (Since))
    }
}

# ------------------------------------------------------------------ ecran
# WinForms : livre avec Windows, s'affiche en 1 a 2 s. Aplats de couleurs,
# memes teintes, taille et disposition que la mire du launcher (420 x 260).
function New-Color([string]$hex) { [System.Drawing.ColorTranslator]::FromHtml($hex) }

function New-Splash($s) {
    $c = @{
        Bg = New-Color '#151A28'; Text = New-Color '#F2F4F9'; Dim = New-Color '#A7B0C8'
        Faint = New-Color '#6F7893'; Line = New-Color '#2C3140'; Ok = New-Color '#63C08E'
        Bad = New-Color '#E8776B'; Accent = New-Color '#94A4CB'; Mark = New-Color '#4B5B86'
        Warn = New-Color '#E2B25A'; WarnBg = New-Color '#2E2B24'; WarnText = New-Color '#EBD4A6'
    }
    $f = New-Object System.Windows.Forms.Form
    $f.FormBorderStyle = 'None'
    $f.StartPosition = 'CenterScreen'
    $f.ClientSize = New-Object System.Drawing.Size(420, 260)
    $f.BackColor = $c.Bg
    $f.TopMost = $true
    $f.ShowInTaskbar = $true
    $f.Text = 'Octipas POS'
    $ico = Join-Path $PSScriptRoot 'logo.ico'
    if (Test-Path -LiteralPath $ico) { try { $f.Icon = New-Object System.Drawing.Icon($ico) } catch { } }

    $label = {
        param($x, $y, $w, $h, $text, $font, $color)
        $l = New-Object System.Windows.Forms.Label
        $l.Location = New-Object System.Drawing.Point($x, $y)
        $l.Size = New-Object System.Drawing.Size($w, $h)
        $l.Text = $text
        $l.Font = $font
        $l.ForeColor = $color
        $l.BackColor = [System.Drawing.Color]::Transparent
        $l.AutoEllipsis = $true
        $f.Controls.Add($l)
        $l
    }
    $rule = {
        param($y)
        $p = New-Object System.Windows.Forms.Panel
        $p.Location = New-Object System.Drawing.Point(22, $y)
        $p.Size = New-Object System.Drawing.Size(376, 1)
        $p.BackColor = $c.Line
        $f.Controls.Add($p)
    }

    $ui = @{ Form = $f; Colors = $c; Rows = @(); Fonts = @{} }
    $ui.Fonts.Row = New-Object System.Drawing.Font('Segoe UI', 10)
    $ui.Fonts.RowBold = New-Object System.Drawing.Font('Segoe UI Semibold', 10)
    $ui.Fonts.Glyph = New-Object System.Drawing.Font('Segoe UI Symbol', 9)

    $mark = & $label 22 20 30 30 'O' (New-Object System.Drawing.Font('Segoe UI', 10, [System.Drawing.FontStyle]::Bold)) ([System.Drawing.Color]::White)
    $mark.BackColor = $c.Mark
    $mark.TextAlign = 'MiddleCenter'
    [void](& $label 63 17 335 22 'Octipas POS' (New-Object System.Drawing.Font('Segoe UI Semibold', 11.5)) $c.Text)
    $ui.Sub = & $label 63 39 335 14 $s.Sub (New-Object System.Drawing.Font('Consolas', 7.5)) $c.Faint
    & $rule 64

    $y = 80
    foreach ($key in $s.Phases) {
        $g = & $label 22 $y 18 20 '○' $ui.Fonts.Glyph $c.Faint
        $t = & $label 44 $y 354 20 $Labels[$key] $ui.Fonts.Row $c.Faint
        $ui.Rows += @{ Key = $key; Glyph = $g; Text = $t; Last = '' }
        $y += 24
    }
    $ui.Detail = & $label 22 ($y + 8) 376 16 '' (New-Object System.Drawing.Font('Consolas', 8)) $c.Faint

    $bar = New-Object System.Windows.Forms.Panel
    $bar.Location = New-Object System.Drawing.Point(22, ($y + 30))
    $bar.Size = New-Object System.Drawing.Size(376, 3)
    $bar.BackColor = $c.Line
    $fill = New-Object System.Windows.Forms.Panel
    $fill.Location = New-Object System.Drawing.Point(0, 0)
    $fill.Size = New-Object System.Drawing.Size(0, 3)
    $fill.BackColor = $c.Accent
    $bar.Controls.Add($fill)
    $f.Controls.Add($bar)
    $ui.Fill = $fill

    $ui.Banner = & $label 22 ($y + 42) 376 30 '⚠  Le démarrage prend plus de temps que d''habitude. Merci de patienter.' (New-Object System.Drawing.Font('Segoe UI', 8.5)) $c.WarnText
    $ui.Banner.BackColor = $c.WarnBg
    $ui.Banner.TextAlign = 'MiddleLeft'
    $ui.Banner.Visible = $false

    & $rule 222
    $ui.Step = & $label 22 230 250 16 '' (New-Object System.Drawing.Font('Segoe UI', 7.5, [System.Drawing.FontStyle]::Bold)) $c.Faint
    $right = & $label 298 230 100 16 'lanceur' (New-Object System.Drawing.Font('Consolas', 7.5)) $c.Faint
    $right.TextAlign = 'TopRight'
    return $ui
}

$Spinner = @('◐', '◓', '◑', '◒')
function Update-Splash($ui, $s, [int]$tick) {
    $c = $ui.Colors
    $done = 0
    foreach ($row in $ui.Rows) {
        $st = $s.PhaseState[$row.Key]
        if (-not $st) { $st = 'pending' }
        if ($st -eq 'done') { $done++ }
        if ($st -eq 'active') { $row.Glyph.Text = $Spinner[$tick % 4] }
        if ($st -ne $row.Last) {
            $row.Last = $st
            switch ($st) {
                'done'   { $row.Glyph.Text = '✓'; $row.Glyph.ForeColor = $c.Ok; $row.Text.ForeColor = $c.Dim; $row.Text.Font = $ui.Fonts.Row }
                'failed' { $row.Glyph.Text = '!'; $row.Glyph.ForeColor = $c.Bad; $row.Text.ForeColor = $c.Text; $row.Text.Font = $ui.Fonts.Row }
                'active' { $row.Glyph.ForeColor = $c.Accent; $row.Text.ForeColor = $c.Text; $row.Text.Font = $ui.Fonts.RowBold }
                default  { $row.Glyph.Text = '○'; $row.Glyph.ForeColor = $c.Faint; $row.Text.ForeColor = $c.Faint; $row.Text.Font = $ui.Fonts.Row }
            }
        }
    }
    $total = [math]::Max(1, $ui.Rows.Count)
    $ui.Fill.Width = [int](376 * $done / $total)
    $ui.Detail.Text = [string]$s.Detail
    $ui.Sub.Text = [string]$s.Sub
    $ui.Step.Text = ('ÉTAPE {0} / {1}' -f ([math]::Min($s.Current + 1, $total)), $total)
    $ui.Banner.Visible = ($null -ne $s.SlowAt -and [DateTime]::Now -gt $s.SlowAt)
}

function Show-Splash($ui, $s, [scriptblock]$Until) {
    $ui.Form.Show()
    $tick = 0
    do {
        Update-Splash $ui $s $tick
        [System.Windows.Forms.Application]::DoEvents()
        Start-Sleep -Milliseconds 80
        $tick++
    } until (& $Until)
    $ui.Form.Close()
    $ui.Form.Dispose()
}

# ------------------------------------------------------------------ main
Write-Journal ('===== {0} [start.ps1] demarrage (session {1}) =====' -f (Get-Horodatage), $env:USERNAME)

$ui = $false
if ($NoSplash) {
    Write-Journal '[start.ps1] ecran de chargement desactive (-NoSplash)'
} elseif (-not $OnWindows) {
    Write-Journal '[start.ps1] ecran de chargement indisponible (hors Windows) : lancement sans ecran'
} else {
    try {
        Add-Type -AssemblyName System.Windows.Forms, System.Drawing
        [System.Windows.Forms.Application]::EnableVisualStyles()
        $ui = $true
    } catch {
        Write-Journal ('[start.ps1] ecran de chargement indisponible ({0}) : lancement sans ecran' -f $_.Exception.Message)
    }
}
$cfg.Ui = $ui

# Launcher deja ouvert (double-clic, relance) : on ne tue rien, on ne
# redemarre rien, on le ramene au premier plan.
$ouvert = @(Get-Process -Name $LauncherProcessName -ErrorAction SilentlyContinue)
if ($ouvert.Count -gt 0) {
    Write-Journal '[start.ps1] launcher deja ouvert : remise au premier plan, rien n''est relance'
    if ($ui) {
        try {
            $state.Phases = @('open'); $state.PhaseState['open'] = 'done'
            $state.Sub = 'DÉJÀ DÉMARRÉE'; $state.Detail = 'Remise au premier plan'
            $fin = [DateTime]::Now.AddMilliseconds(1200)
            Show-Splash (New-Splash $state) $state { [DateTime]::Now -gt $fin }
        } catch { }
    }
    try {
        Add-Type -AssemblyName Microsoft.VisualBasic
        $fenetre = $ouvert | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } | Select-Object -First 1
        if ($fenetre) { [Microsoft.VisualBasic.Interaction]::AppActivate($fenetre.Id) }
    } catch { }
    exit 0
}

if ($cfg.WslVersion) { $state.Phases = @('services', 'launch') } else { $state.Phases = @('launch') }

try {
    if ($ui) {
        $splash = New-Splash $state
        $runner = [powershell]::Create()
        [void]$runner.AddScript($orchestrate.ToString()).AddArgument($state).AddArgument($cfg)
        $handle = $runner.BeginInvoke()
        Show-Splash $splash $state { $state.HandedOff -or $handle.IsCompleted }
        try { [void]$runner.EndInvoke($handle) } catch { }
        $runner.Dispose()
    } else {
        & $orchestrate $state $cfg
    }
} catch {
    Write-Journal ('[start.ps1] erreur : {0}' -f $_.Exception.Message)
} finally {
    # Regle d'or : si rien n'a pu lancer le launcher, on le lance quand meme.
    if (-not $state.LauncherStarted) {
        Write-Journal '[start.ps1] launcher non lance par la sequence : lancement de secours'
        try {
            Start-Process -FilePath $LauncherExe -ArgumentList @('-c', ('"{0}"' -f $LauncherConfig)) -WorkingDirectory $MaintenanceDir | Out-Null
        } catch {
            Write-Journal ('[start.ps1] lancement de secours impossible : {0}' -f $_.Exception.Message)
        }
    }
}
exit 0
