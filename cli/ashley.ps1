# ashley.ps1 (Windows PowerShell): forwards to the grid-side CLI over Windows OpenSSH.
#   .\ashley.ps1 status
#   .\ashley.ps1 worker start --name default --hours 24
#   Get-Content req.json | .\ashley.ps1 ask --worker default --json --stream
$grid = if ($env:ASHLEY_GRID) { $env:ASHLEY_GRID } else { 'wsu-grid' }
$remote = @('~/.ashley/bin/ashley') + $args
if ([Console]::IsInputRedirected) {
  $input | & ssh -o BatchMode=yes -o ConnectTimeout=20 $grid -- @remote
} else {
  & ssh -o BatchMode=yes -o ConnectTimeout=20 $grid -- @remote
}
exit $LASTEXITCODE
