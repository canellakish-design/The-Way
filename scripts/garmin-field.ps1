<#
  The Way: build the Garmin data field and put it on the Edge, by hand or by itself.
  Run on the Zwift Lab PC, from the repo folder (Documents\The-Way), by Harry or by Claude:

    powershell -ExecutionPolicy Bypass -File scripts\garmin-field.ps1
        pull main, build garmin\the-way-field for the Edge 1050 (Release), copy it to the Edge if it is plugged in

    powershell -ExecutionPolicy Bypass -File scripts\garmin-field.ps1 -Auto
        the unattended run (what the scheduled task does): build only when main's field has changed since the last
        build, copy only when the Edge is plugged in and lacks the newest build; quiet when there is nothing to do

    powershell -ExecutionPolicy Bypass -File scripts\garmin-field.ps1 -Install
        register the Windows scheduled task "The Way - Garmin field": -Auto every 15 minutes and at logon

    options:
      -Commit       first commit the field's local changes and push them to the branch garmin-field (never main)
      -NoPull       build what is on disk without pulling
      -NoCopy       build only
      -NoReport     do not tell the site (by default each run that did something posts to /garmin/build)
      -Device edge1050   another Connect IQ device id
      -Key C:\path\developer_key.der   the developer key (found on its own otherwise)
      -Bridge https://thewayforward.netlify.app   where to report

  It never throws away local work: with uncommitted changes to the field and no -Commit, it does not pull and
  builds what is on disk (and -Auto does nothing at all). The last line it prints is one line of JSON, the same
  one it posts to the site, where Claude reads it from anywhere: GET /garmin/build.
  Exit codes: 0 done (or nothing to do); 1 build failed; 2 SDK, Java or key not found; 3 built but the Edge was not found.
#>
param([switch]$Auto, [switch]$Install, [switch]$Commit, [switch]$NoPull, [switch]$NoCopy, [switch]$NoReport,
      [string]$Device = "edge1050", [string]$Key = "", [string]$Bridge = "https://thewayforward.netlify.app")
$ErrorActionPreference = "Stop"
$repo  = Split-Path -Parent $PSScriptRoot
$field = Join-Path $repo "garmin\the-way-field"
$out   = Join-Path $field "bin\TheWayField.prg"
$state = Join-Path $field "bin\last.json"
$res   = [ordered]@{ ok = $false; mode = $(if ($Auto) { "auto" } else { "manual" }); host = $env:COMPUTERNAME; commit = $null; tree = $null
                     built = $false; bytes = $null; copied = $null; pulled = $false; committed = $null; note = $null }
$last  = if (Test-Path $state) { Get-Content $state -Raw | ConvertFrom-Json } else { [pscustomobject]@{ built_tree = $null; copied_tree = $null } }
function Save-State { New-Item -ItemType Directory -Force -Path (Split-Path $state) | Out-Null; $last | ConvertTo-Json | Set-Content $state }
function Done($code, [switch]$Quiet) {
  $json = $res | ConvertTo-Json -Compress
  if (-not $Quiet -and -not $NoReport) {
    try { Invoke-RestMethod -Method Post -Uri "$Bridge/.netlify/functions/api/garmin/build" -Headers @{ "x-the-way-app" = "1" } -ContentType "application/json" -Body $json -TimeoutSec 20 | Out-Null }
    catch { }   # the site being away never stops the build
  }
  Write-Output $json; exit $code
}
Set-Location $repo

# ---- the scheduled task ----
if ($Install) {
  $ps = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSCommandPath`" -Auto"
  $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $ps -WorkingDirectory $repo
  $every = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 15)
  $logon = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
  $set = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
  Register-ScheduledTask -TaskName "The Way - Garmin field" -Action $action -Trigger @($every, $logon) -Settings $set -Description "Builds The Way's Garmin data field when main changes and puts it on the Edge when it is plugged in (scripts\garmin-field.ps1 -Auto)." -Force | Out-Null
  $res.ok = $true; $res.mode = "install"; $res.note = "scheduled task 'The Way - Garmin field' registered: -Auto every 15 minutes and at logon"; Done 0
}

# ---- 1. the repo: keep local work, then pull ----
$st = git status --porcelain -- garmin/the-way-field
$dirty = [bool]$st
if ($Auto -and $dirty) { $res.ok = $true; $res.note = "the field has uncommitted changes on this PC: the unattended run leaves them alone"; Done 0 -Quiet }
if ($Commit -and $dirty) {
  $here = (git rev-parse --abbrev-ref HEAD).Trim()
  git add -- garmin/the-way-field | Out-Null
  git commit -m "Garmin field: the layout as built on the Zwift Lab PC" -m "Committed by scripts/garmin-field.ps1." | Out-Null
  git push origin "HEAD:refs/heads/garmin-field" 2>&1 | Out-Null
  $res.committed = "pushed to the branch garmin-field from $here"
  $dirty = $false
}
if (-not $NoPull) {
  if ($dirty) { $res.note = "the field has uncommitted changes: not pulled, built as it is on disk (use -Commit to keep them on a branch)" }
  else { git pull --ff-only origin main 2>&1 | Out-Null; if ($LASTEXITCODE -eq 0) { $res.pulled = $true } else { $res.note = "git pull failed; built what is on disk" } }
}
$res.commit = (git rev-parse --short HEAD).Trim()
$res.tree = if ($dirty) { "local" } else { (git rev-parse HEAD:garmin/the-way-field).Trim() }

# the unattended run: nothing new to build, and the Edge already has it (or is not here): stop, quietly
$edgeHere = { (Get-PSDrive -PSProvider FileSystem | Where-Object { Test-Path (Join-Path $_.Root "GARMIN\Apps") }) -or ((New-Object -ComObject Shell.Application).Namespace(17).Items() | Where-Object { $_.Name -match 'Edge' }) }
$needBuild = (-not $Auto) -or ($last.built_tree -ne $res.tree) -or (-not (Test-Path $out))
$needCopy  = (-not $NoCopy) -and ((-not $Auto) -or ($last.copied_tree -ne $res.tree) -or $needBuild)
if ($Auto -and -not $needBuild -and (-not $needCopy -or -not (& $edgeHere))) { $res.ok = $true; $res.note = "nothing to do"; Done 0 -Quiet }

if ($needBuild) {
  # ---- 2. the SDK, Java and the key ----
  $ciq = Join-Path $env:APPDATA "Garmin\ConnectIQ"
  $sdk = $null
  $cfg = Join-Path $ciq "current-sdk.cfg"
  if (Test-Path $cfg) { $p = (Get-Content $cfg -Raw).Trim(); if (Test-Path (Join-Path $p "bin\monkeyc.bat")) { $sdk = $p } }
  if (-not $sdk) {
    $d = Get-ChildItem (Join-Path $ciq "Sdks") -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 1
    if ($d) { $sdk = $d.FullName }
  }
  if (-not $sdk) { $res.note = "no Connect IQ SDK found under $ciq (VS Code: Monkey C: Verify Installation)"; Done 2 }
  $monkeyc = Join-Path $sdk "bin\monkeyc.bat"
  if (-not (Get-Command java -ErrorAction SilentlyContinue)) { $res.note = "Java is not on PATH; the SDK needs it"; Done 2 }
  if (-not $Key) {
    $vs = Join-Path $env:APPDATA "Code\User\settings.json"
    if (Test-Path $vs) { $m = Select-String -Path $vs -Pattern '"monkeyC\.developerKeyPath"\s*:\s*"([^"]+)"' | Select-Object -First 1; if ($m) { $Key = $m.Matches[0].Groups[1].Value -replace '\\\\', '\' } }
  }
  if (-not $Key) {
    $k = Get-ChildItem -Path (Join-Path $HOME "Garmin"), (Join-Path $HOME "Documents\Garmin") -Recurse -Filter *.der -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($k) { $Key = $k.FullName }
  }
  if (-not $Key -or -not (Test-Path $Key)) { $res.note = "no developer key found (VS Code: Monkey C: Generate a Developer Key, or pass -Key)"; Done 2 }

  # ---- 3. build, Release ----
  New-Item -ItemType Directory -Force -Path (Split-Path $out) | Out-Null
  & $monkeyc -d $Device -f (Join-Path $field "monkey.jungle") -o $out -y $Key -r -w
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $out)) { $res.note = "the build failed (the compiler's lines are above)"; Done 1 }
  $res.built = $true
  if ($res.tree -ne "local") { $last.built_tree = $res.tree; Save-State }
}
$res.bytes = (Get-Item $out).Length
if (-not $needCopy) { $res.ok = $true; Done 0 }

# ---- 4. onto the Edge: a drive letter if it mounts as one, else the Edge over MTP (how the 1040 and 1050 connect) ----
function Copied($where) { $res.copied = $where; $res.ok = $true; if ($res.tree -ne "local") { $last.copied_tree = $res.tree; Save-State }; Done 0 }
$drive = Get-PSDrive -PSProvider FileSystem | Where-Object { Test-Path (Join-Path $_.Root "GARMIN\Apps") } | Select-Object -First 1
if ($drive) { Copy-Item $out (Join-Path $drive.Root "GARMIN\Apps\TheWayField.prg") -Force; Copied "$($drive.Root)GARMIN\Apps" }
$shell = New-Object -ComObject Shell.Application
$edge = $shell.Namespace(17).Items() | Where-Object { $_.Name -match 'Edge' } | Select-Object -First 1
if (-not $edge) { $res.ok = $true; $res.note = "built; the Edge is not plugged in (or not unlocked): it goes on at the next run with the Edge here"; Done 3 }
$step = $edge.GetFolder
foreach ($name in @('Internal Storage', 'Primary', 'GARMIN', 'Apps')) {
  $next = $step.Items() | Where-Object { $_.Name -eq $name } | Select-Object -First 1
  if ($next) { $step = $next.GetFolder } elseif ($name -in @('GARMIN', 'Apps')) { $res.note = "the Edge has no $name folder"; Done 3 }
}
$old = $step.Items() | Where-Object { $_.Name -match '^TheWayField(\.prg)?$' } | Select-Object -First 1
if ($old) { $old.InvokeVerb('delete'); Start-Sleep -Seconds 2 }
$step.CopyHere($out, 4 + 16)   # no progress dialog, yes to all
for ($i = 0; $i -lt 30; $i++) { Start-Sleep -Seconds 1; if ($step.Items() | Where-Object { $_.Name -match '^TheWayField(\.prg)?$' }) { break } }
if ($step.Items() | Where-Object { $_.Name -match '^TheWayField(\.prg)?$' }) { Copied "$($edge.Name) (MTP) GARMIN\Apps" }
$res.note = "built; the copy to the Edge did not show up in GARMIN\Apps within 30 s"; Done 3
