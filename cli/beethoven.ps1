# beethoven.ps1 (Windows PowerShell): forwards to the grid-side CLI over Windows OpenSSH.
#   .\beethoven.ps1 status
#   .\beethoven.ps1 worker start --name default --hours 24
#   Get-Content req.json | .\beethoven.ps1 ask --worker default --json --stream
# The grid command is ~/.beethoven/bin/beethoven; an account whose grid install predates the rename
# has only ~/.ashley/bin/ashley, which answers instead until the next grid install moves the folder.
$grid = if ($env:BEETHOVEN_GRID) { $env:BEETHOVEN_GRID } elseif ($env:ASHLEY_GRID) { $env:ASHLEY_GRID } else { 'wsu-grid' }  # ASHLEY_GRID: the old name
$pick = 'b=$HOME/.beethoven/bin/beethoven; [ -x $b ] || b=$HOME/.ashley/bin/ashley; exec $b'
# one remote command line, each argument quoted once for the grid's bash (no double quotes: PowerShell 5.1 mangles them)
$remote = (@($pick) + ($args | ForEach-Object { "'" + ([string]$_ -replace "'", "'\''") + "'" })) -join ' '
if ([Console]::IsInputRedirected) {
  $input | & ssh -o BatchMode=yes -o ConnectTimeout=20 $grid -- $remote
} else {
  & ssh -o BatchMode=yes -o ConnectTimeout=20 $grid -- $remote
}
exit $LASTEXITCODE
