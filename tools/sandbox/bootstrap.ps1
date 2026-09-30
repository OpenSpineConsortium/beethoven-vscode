<#
Runs inside Windows Sandbox (bootstrap.cmd starts it at logon): puts VS Code on the clean machine,
installs Beethoven for VS Code, writes sandbox-report.txt on the desktop and opens VS Code on an
empty folder. Nothing else is installed, no Node, no Git, no Claude Code: the point is to see what
a student sees on a laptop that has only VS Code, so the extension's own first-run path (the
signing dialog, the license, the sign-ins, the wizard's checks for what is missing) is what gets
tested.

  bootstrap.ps1                 install the newest beethoven-*.vsix from the mapped dist folder
  bootstrap.ps1 -Marketplace    install openspineconsortium.beethoven from the Marketplace instead

Every failure is printed and written to the report; the script never stops silently. Written for
Windows PowerShell 5.1, the only PowerShell the sandbox has.
#>
param(
  [switch]$Marketplace,
  [string]$DistFolder = (Join-Path $env:USERPROFILE 'Desktop\beethoven-dist'),
  [string]$WorkFolder = (Join-Path $env:USERPROFILE 'Desktop\work'),
  [string]$ReportPath = (Join-Path $env:USERPROFILE 'Desktop\sandbox-report.txt')
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # Invoke-WebRequest is many times slower with its progress bar
$started = Get-Date
$VsCodeUrl = 'https://update.code.visualstudio.com/latest/win32-x64-user/stable'
$CodeCmd = Join-Path $env:LOCALAPPDATA 'Programs\Microsoft VS Code\bin\code.cmd'
$MarketplaceId = 'openspineconsortium.beethoven'   # the item since 4.0.0 (openspineconsortium.ashley is retired)
$results = New-Object System.Collections.Generic.List[string]   # one line per step, for the report
$failed = $false
$installer = Join-Path $env:TEMP 'VSCodeUserSetup-x64.exe'
$codeVersion = $null

# Write-Host, not Write-Output: a line on the output stream would become part of the value a Step
# returns, and "if ($downloaded)" would then be true after a failure. The console host still puts
# these lines on stdout when it is redirected, so bootstrap.cmd's log gets them.
function Say([string]$text) {
  Write-Host ('[{0}] {1}' -f (Get-Date -Format 'HH:mm:ss'), $text)
}

function Record([string]$step, [string]$outcome, [string]$detail) {
  $script:results.Add(('{0,-8} {1,-15} {2}' -f $outcome, $step, $detail))
  Say ('{0}: {1}. {2}' -f $step, $outcome, $detail)
}

# Runs one step; a failure is recorded and the script goes on to the next one.
function Step([string]$name, [scriptblock]$body) {
  try {
    $detail = & $body
    Record $name 'ok' ([string]$detail)
    return $true
  } catch {
    $script:failed = $true
    Record $name 'FAILED' $_.Exception.Message
    return $false
  }
}

# Runs a program and returns its output as text with its exit code. A line on stderr is text, not
# an error: Windows PowerShell 5.1 would otherwise stop at the first one.
function Native([string]$exe, [string[]]$arguments) {
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $out = & $exe @arguments 2>&1 | ForEach-Object { "$_" }
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $prev
  }
  return @{ text = (($out | Out-String).Trim()); code = $code }
}

Say ('Beethoven for VS Code on a virgin Windows: ' + $(if ($Marketplace) { "Marketplace build ($MarketplaceId)" } else { "VSIX from $DistFolder" }))

# 1. TLS 1.2: Windows PowerShell 5.1 does not offer it to web servers unless told to.
[void](Step 'tls' {
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  'TLS 1.2 on'
})

# 2. The network: the logon command can start before the sandbox has an address.
$online = Step 'network' {
  $deadline = (Get-Date).AddSeconds(120)
  while ($true) {
    try {
      [void][System.Net.Dns]::GetHostAddresses('update.code.visualstudio.com')
      break
    } catch {
      if ((Get-Date) -gt $deadline) { throw 'no network after 120 s (the .wsb needs Networking Default and the host must be online)' }
      Start-Sleep -Seconds 5
    }
  }
  'update.code.visualstudio.com resolves'
}

# 3. Download the VS Code user installer. The update server answers with a redirect to the file
#    and states the file's sha256 in a header, so the download is checked against something the
#    installer cannot fake; when the header is missing the download still goes ahead and the
#    report says it was not checked.
$downloaded = $false
if ($online) {
  $downloaded = Step 'download' {
    $target = $VsCodeUrl
    $expected = $null
    try {
      $req = [System.Net.HttpWebRequest]::Create($VsCodeUrl)
      $req.Method = 'HEAD'
      $req.AllowAutoRedirect = $false
      $req.Timeout = 30000
      $resp = $req.GetResponse()
      try {
        if ($resp.Headers['Location']) { $target = $resp.Headers['Location'] }
        if ($resp.Headers['x-sha256']) { $expected = $resp.Headers['x-sha256'] }
      } finally {
        $resp.Close()
      }
    } catch {
      Say ('could not read the redirect ({0}); downloading the plain URL' -f $_.Exception.Message)
    }
    $attempt = 0
    while ($true) {
      $attempt++
      try {
        Invoke-WebRequest -Uri $target -OutFile $script:installer -UseBasicParsing
        break
      } catch {
        if ($attempt -ge 3) { throw }
        Say ('download attempt {0} failed: {1}' -f $attempt, $_.Exception.Message)
        Start-Sleep -Seconds 10
      }
    }
    $size = (Get-Item -LiteralPath $script:installer).Length
    if ($size -lt 50MB) { throw ('the download is only {0} bytes, not an installer' -f $size) }
    $name = Split-Path -Leaf $target
    if ($expected) {
      $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $script:installer).Hash
      if ($actual -ne $expected) { throw ('sha256 {0} does not match the update server''s {1}; not running it' -f $actual, $expected) }
      return ('{0}, {1:N0} bytes, sha256 matches the update server' -f $name, $size)
    }
    return ('{0}, {1:N0} bytes, sha256 not stated by the server' -f $name, $size)
  }
} else {
  Record 'download' 'skipped' 'no network'
}

# 4. Install VS Code for this user, silently. The tasks: do not start it, do add it to PATH.
$vsInstalled = $false
if ($downloaded) {
  $vsInstalled = Step 'install-vscode' {
    $p = Start-Process -FilePath $script:installer -ArgumentList '/VERYSILENT', '/NORESTART', '/MERGETASKS=!runcode,addtopath' -Wait -PassThru
    if ($p.ExitCode -ne 0) { throw ('the installer exited with code {0}' -f $p.ExitCode) }
    if (-not (Test-Path -LiteralPath $CodeCmd)) { throw ('the installer finished but {0} is missing' -f $CodeCmd) }
    $v = Native $CodeCmd @('--version')
    if ($v.code -ne 0) { throw ('code --version exited with {0}: {1}' -f $v.code, $v.text) }
    $script:codeVersion = ($v.text -split "`r?`n")[0]
    'VS Code {0} at {1}' -f $script:codeVersion, $CodeCmd
  }
} else {
  Record 'install-vscode' 'skipped' 'no installer'
}

# 5. Install Beethoven for VS Code: the newest VSIX from the mapped dist folder (the same rule as make_wsb.py:
#    most recently modified), or the Marketplace build.
$extInstalled = $false
if ($vsInstalled) {
  $extInstalled = Step 'install-beethoven' {
    if ($Marketplace) {
      $what = $MarketplaceId
      $r = Native $CodeCmd @('--install-extension', $MarketplaceId, '--force')
    } else {
      if (-not (Test-Path -LiteralPath $DistFolder)) { throw ('{0} is not there: the .wsb did not map the repository''s dist folder' -f $DistFolder) }
      $vsix = Get-ChildItem -LiteralPath $DistFolder -Filter 'beethoven-*.vsix' | Sort-Object LastWriteTime, Name -Descending | Select-Object -First 1
      if (-not $vsix) { throw ('no beethoven-*.vsix in {0}' -f $DistFolder) }
      $what = $vsix.Name
      $r = Native $CodeCmd @('--install-extension', $vsix.FullName, '--force')
    }
    if ($r.code -ne 0) { throw ('code --install-extension {0} exited with {1}: {2}' -f $what, $r.code, $r.text) }
    '{0}: {1}' -f $what, (($r.text -replace '\s+', ' ').Trim())
  }
} else {
  Record 'install-beethoven' 'skipped' 'VS Code is not installed'
}

# 6. Open VS Code on an empty folder, the way a student would after installing. PATH is re-read
#    first so the window sees what the installer added, as a window opened from the Start menu would.
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
[void](Step 'open-vscode' {
  New-Item -ItemType Directory -Force -Path $WorkFolder | Out-Null
  if (-not $vsInstalled) { throw 'VS Code is not installed' }
  Start-Process -FilePath $CodeCmd -ArgumentList ('"{0}"' -f $WorkFolder) -WindowStyle Hidden
  'opened {0}' -f $WorkFolder
})

# 7. The report: what this clean machine had, and what happened. Written even when a step above
#    failed, and opened in Notepad so nothing fails out of sight.
$lines = New-Object System.Collections.Generic.List[string]
try {
  $os = Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
  $product = $os.ProductName
  if ([int]$os.CurrentBuild -ge 22000) { $product = $product -replace 'Windows 10', 'Windows 11' }   # the registry still says 10 on 11
  $build = '{0} {1}, build {2}.{3}' -f $product, $os.DisplayVersion, $os.CurrentBuild, $os.UBR
  $ssh = Get-Command ssh -ErrorAction SilentlyContinue
  $sshKeygen = Get-Command ssh-keygen -ErrorAction SilentlyContinue
  $extensions = 'VS Code is not installed'
  if ($vsInstalled) { $extensions = (Native $CodeCmd @('--list-extensions', '--show-versions')).text }
  if (-not $extensions) { $extensions = '(none)' }
  $elapsed = [int]((Get-Date) - $started).TotalSeconds
  $lines.Add('Beethoven for VS Code on a virgin Windows (Windows Sandbox)')
  $lines.Add('written      ' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
  $lines.Add('source       ' + $(if ($Marketplace) { "Marketplace, $MarketplaceId" } else { "VSIX from $DistFolder" }))
  $lines.Add('windows      ' + $build)
  $lines.Add('ssh.exe      ' + $(if ($ssh) { $ssh.Source } else { 'absent (the OpenSSH client is a Windows optional feature; the wizard must say so at the SSH steps)' }))
  $lines.Add('ssh-keygen   ' + $(if ($sshKeygen) { $sshKeygen.Source } else { 'absent' }))
  $lines.Add('vs code      ' + $(if ($codeVersion) { $codeVersion } else { 'not installed' }))
  $lines.Add('beethoven    ' + $(if ($extInstalled) { 'installed' } else { 'NOT installed' }))
  $lines.Add('elapsed      ' + $elapsed + ' s')
  $lines.Add('result       ' + $(if ($failed) { 'FAILED, see the steps below' } else { 'ok' }))
  $lines.Add('')
  $lines.Add('steps')
  foreach ($r in $results) { $lines.Add('  ' + $r) }
  $lines.Add('')
  $lines.Add('installed extensions')
  foreach ($e in ($extensions -split "`r?`n")) { $lines.Add('  ' + $e) }
  $lines.Add('')
  $lines.Add('The log of this run is sandbox-bootstrap.log on this desktop. Closing the sandbox discards everything.')
} catch {
  $failed = $true
  $lines.Add('the report itself failed: ' + $_.Exception.Message)
  foreach ($r in $results) { $lines.Add('  ' + $r) }
}
try {
  Set-Content -LiteralPath $ReportPath -Value $lines -Encoding UTF8
  Say ('report written: {0}' -f $ReportPath)
  Start-Process -FilePath 'notepad.exe' -ArgumentList ('"{0}"' -f $ReportPath)
} catch {
  $failed = $true
  Say ('could not write the report to {0}: {1}' -f $ReportPath, $_.Exception.Message)
  $lines | ForEach-Object { Say $_ }
}

if ($failed) { Say 'finished with failures'; exit 1 }
Say 'finished'
exit 0
