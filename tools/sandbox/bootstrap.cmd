@echo off
rem Windows Sandbox runs this at logon (the LogonCommand in the .wsb that make_wsb.py writes).
rem It hands over to bootstrap.ps1 and keeps a copy of everything printed in a log on the sandbox
rem desktop, next to the report. Any switch given here (for example -Marketplace) goes through.
setlocal
set "HERE=%~dp0"
set "LOG=%USERPROFILE%\Desktop\sandbox-bootstrap.log"
echo Ashley on a virgin Windows: setting up. Log: %LOG%
powershell -NoProfile -ExecutionPolicy Bypass -File "%HERE%bootstrap.ps1" %* 2>&1 | powershell -NoProfile -ExecutionPolicy Bypass -Command "$input | Tee-Object -FilePath '%LOG%'"
echo Done. The report is %USERPROFILE%\Desktop\sandbox-report.txt
endlocal
