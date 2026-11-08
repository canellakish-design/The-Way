<#
  The Way: build the Garmin data field and put it on the Edge, in one command.
  Run on the Zwift Lab PC, from the repo folder (Documents\The-Way), by Harry or by Claude:

    powershell -ExecutionPolicy Bypass -File scripts\garmin-field.ps1
        pull main, build garmin\the-way-field for the Edge 1050 (Release), copy it to the Edge if it is plugged in

    options:
      -Commit       first commit the field's local changes and push them to the branch garmin-field (never main)
      -NoPull       build what is on disk without pulling
      -NoCopy       build only
      -Device edge1050   another Connect IQ device id
      -Key C:\path\developer_key.der   the developer key (found on its own otherwise)

  It never throws away local work: with uncommitted changes to the field and no -Commit, it does not pull and
  builds what is on disk. The last line it prints is one line of JSON, for Claude to read:
    {"ok":true,"built":"...TheWayField.prg","bytes":19126,"copied":"Edge 1050 (MTP)","pulled":true,"committed":null}
  Exit codes: 0 done; 1 build failed; 2 SDK, Java or key not found; 3 built but the Edge was not found.
#>
param([switch]$Commit, [switch]$NoPull, [switch]$NoCopy, [string]$Device = "edge1050", [string]$Key = "")
$ErrorActionPreference = "Stop"
$repo  = Split-Path -Parent $PSScriptRoot
$field = Join-Path $repo "garmin\the-way-field"
$out   = Join-Path $field "bin\TheWayField.prg"
$res   = [ordered]@{ ok = $false; built = $null; bytes = $null; copied = $null; pulled = $false; committed = $null; note = $null }
function Done($code) { Write-Output ($res | ConvertTo-Json -Compress); exit $code }
Set-Location $repo

# ---- 1. the repo: keep local work, then pull ----
$st = git status --porcelain -- garmin/the-way-field
$dirty = [bool]$st
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
$res.built = $out; $res.bytes = (Get-Item $out).Length
if ($NoCopy) { $res.ok = $true; Done 0 }

# ---- 4. onto the Edge: a drive letter if it mounts as one, else the Edge over MTP (how the 1040 and 1050 connect) ----
$drive = Get-PSDrive -PSProvider FileSystem | Where-Object { Test-Path (Join-Path $_.Root "GARMIN\Apps") } | Select-Object -First 1
if ($drive) {
  Copy-Item $out (Join-Path $drive.Root "GARMIN\Apps\TheWayField.prg") -Force
  $res.copied = "$($drive.Root)GARMIN\Apps"; $res.ok = $true; Done 0
}
$shell = New-Object -ComObject Shell.Application
$pc = $shell.Namespace(17)   # This PC
$edge = $pc.Items() | Where-Object { $_.Name -match 'Edge' } | Select-Object -First 1
if (-not $edge) { $res.note = "built; the Edge is not plugged in (or not unlocked): plug it in and run again"; $res.ok = $true; Done 3 }
$step = $edge.GetFolder
foreach ($name in @('Internal Storage', 'Primary', 'GARMIN', 'Apps')) {
  $next = $step.Items() | Where-Object { $_.Name -eq $name } | Select-Object -First 1
  if ($next) { $step = $next.GetFolder } elseif ($name -in @('GARMIN', 'Apps')) { $res.note = "the Edge has no $name folder"; Done 3 }
}
$old = $step.Items() | Where-Object { $_.Name -match '^TheWayField(\.prg)?$' } | Select-Object -First 1
if ($old) { $old.InvokeVerb('delete'); Start-Sleep -Seconds 2 }
$step.CopyHere($out, 4 + 16)   # no progress dialog, yes to all
for ($i = 0; $i -lt 30; $i++) { Start-Sleep -Seconds 1; if ($step.Items() | Where-Object { $_.Name -match '^TheWayField(\.prg)?$' }) { break } }
if ($step.Items() | Where-Object { $_.Name -match '^TheWayField(\.prg)?$' }) { $res.copied = "$($edge.Name) (MTP) GARMIN\Apps"; $res.ok = $true; Done 0 }
$res.note = "built; the copy to the Edge did not show up in GARMIN\Apps within 30 s"; Done 3
