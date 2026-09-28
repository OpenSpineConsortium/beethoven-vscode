<#
Turns on Windows Sandbox once, on the maintainer's machine (Windows 10 or 11 Pro, Enterprise or
Education; virtualisation on in the firmware). Needs an elevated PowerShell and a restart
afterwards. Run without elevation, it prints the one command to run.

  powershell -NoProfile -ExecutionPolicy Bypass -File tools\sandbox\enable_sandbox.ps1
#>
$feature = 'Containers-DisposableClientVM'

$me = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $me.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Output 'This needs an elevated PowerShell. Open a PowerShell window (not cmd or Git Bash) and paste this one line; it asks for consent, then does the rest:'
  Write-Output ('  Start-Process powershell -Verb RunAs -ArgumentList ''-NoProfile -ExecutionPolicy Bypass -NoExit -File "{0}"''' -f $PSCommandPath)
  exit 1
}

$os = Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
if ($os.EditionID -match 'Core') {
  Write-Output ('This is {0} (edition {1}). Windows Sandbox needs Pro, Enterprise or Education.' -f $os.ProductName, $os.EditionID)
  exit 1
}

$state = (Get-WindowsOptionalFeature -Online -FeatureName $feature).State
if ($state -eq 'Enabled') {
  Write-Output 'Windows Sandbox is already enabled. If WindowsSandbox.exe is still missing, restart Windows once.'
  exit 0
}

Write-Output ('Enabling {0} (Windows Sandbox)...' -f $feature)
$r = Enable-WindowsOptionalFeature -Online -FeatureName $feature -All -NoRestart
Write-Output ('Windows Sandbox is enabled (restart needed: {0}).' -f $r.RestartNeeded)
Write-Output 'Restart Windows to finish. After the restart: python tools\sandbox\make_wsb.py, then double-click the .wsb it writes.'
exit 0
