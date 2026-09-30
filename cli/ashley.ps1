# The forwarder's name before the rename (it is now cli/beethoven.ps1), kept so scripts and notes
# that call it keep working: it runs beethoven.ps1 beside it.
$next = Join-Path $PSScriptRoot 'beethoven.ps1'
if ([Console]::IsInputRedirected) { $input | & $next @args } else { & $next @args }
exit $LASTEXITCODE
