/**
 * The PowerShell side of the presence probe. Kept as one long-lived process
 * that answers single-word commands on stdin: spawning a shell every 30 s
 * would blow the idle-CPU budget on its own.
 *
 * That budget is why the system and process monitors ask *here* rather than
 * through `systeminformation`. Every one of its Windows queries spawns a cold
 * `powershell.exe` — measured at ~640 ms of CPU each, and the monitors between
 * them were doing nineteen a minute. In this already-running host the same
 * questions answer in 11-18 ms.
 *
 * The P/Invoke lives in `resources/probe/CodexProbe.cs` and is precompiled to
 * `CodexProbe.dll` by `pnpm probe-dll` (§8.5, §21 — still no native module).
 * It used to be compiled here on every launch by an inline `Add-Type`, which
 * cost 14-25 s cold and put all of it inside the login storm; loading the
 * prebuilt assembly takes ~123 ms. The `.cs` is shipped alongside the DLL and
 * compiled as a fallback, so a checkout that never ran the build step still
 * has working fullscreen detection.
 *
 * The script takes the directory holding both as its one parameter.
 */
export const PROBE_SCRIPT = String.raw`
param([string]$ProbeDir = '')

$ErrorActionPreference = 'SilentlyContinue'

# Prefer the prebuilt assembly; fall back to compiling the source it was built
# from. Neither present is not fatal — the fullscreen answer degrades to "not
# active", which is the same way every other probe failure behaves.
$FullscreenReady = $false
foreach ($candidate in @((Join-Path $ProbeDir 'CodexProbe.dll'), (Join-Path $ProbeDir 'CodexProbe.cs'))) {
  if (-not (Test-Path $candidate)) { continue }
  try {
    Add-Type -Path $candidate -ErrorAction Stop
    $FullscreenReady = $true
    break
  } catch {
    [Console]::Error.WriteLine('probe: cannot load ' + $candidate + ' - ' + $_.Exception.Message)
  }
}
if (-not $FullscreenReady) {
  [Console]::Error.WriteLine('probe: no fullscreen detector in ' + $ProbeDir + ' - reporting not fullscreen')
}

# A DLL built before the focus monitor existed loads fine and simply lacks the
# method. Asking it anyway would print an error per poll; an empty reply reads
# as "no reading" on the Node side, the same as a window with no owner.
$ForegroundReady = $FullscreenReady -and ($null -ne [CodexProbe].GetMethod('ForegroundInfo'))
if ($FullscreenReady -and -not $ForegroundReady) {
  [Console]::Error.WriteLine('probe: CodexProbe has no ForegroundInfo - rebuild it with pnpm probe-dll; focus monitor disabled')
}

function Get-MicrophoneUsers {
  # LastUsedTimeStop == 0 means "still in use" (§8.5). The names are returned
  # rather than a bare flag, because some applications (Discord, Teams) hold
  # the capture device open for their whole lifetime; the Node side compares
  # against a baseline so only a *new* holder counts as a call.
  # The registry shape varies between builds, hence the belt-and-braces guards.
  $roots = @(
    'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone\NonPackaged',
    'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone'
  )
  $found = New-Object System.Collections.Generic.List[string]
  foreach ($root in $roots) {
    if (-not (Test-Path $root)) { continue }
    foreach ($key in (Get-ChildItem -Path $root -ErrorAction SilentlyContinue)) {
      $stop = (Get-ItemProperty -Path $key.PSPath -Name 'LastUsedTimeStop' -ErrorAction SilentlyContinue).LastUsedTimeStop
      if ($null -ne $stop -and [int64]$stop -eq 0) { $found.Add($key.PSChildName) }
    }
  }
  return ($found -join '|')
}

function Get-ProcessNames {
  # Names only, and no extension: Get-Process reports 'chrome', where the
  # watchlist is written 'chrome.exe'. The Node side strips both to compare,
  # so neither form has to win here.
  return ((Get-Process | ForEach-Object { $_.ProcessName.ToLowerInvariant() } | Sort-Object -Unique) -join '|')
}

function Get-DriveSpace {
  # 'letter:free:size' per fixed drive.
  #
  # DriveInfo rather than Get-PSDrive, and Fixed rather than every provider
  # drive: a disconnected network mapping makes Get-PSDrive block for seconds,
  # and this host answers one command at a time — a stall here would hold up
  # the fullscreen and microphone readings the suppression rules depend on.
  $out = New-Object System.Collections.Generic.List[string]
  foreach ($drive in [System.IO.DriveInfo]::GetDrives()) {
    if ($drive.DriveType -ne 'Fixed' -or -not $drive.IsReady) { continue }
    $letter = $drive.Name.TrimEnd('\', ':')
    $out.Add($letter + ':' + [int64]$drive.AvailableFreeSpace + ':' + [int64]$drive.TotalSize)
  }
  return ($out -join '|')
}

function Get-BatteryState {
  # 'status:percent', or 'none' on a machine with no battery at all.
  # BatteryStatus 2 means running on AC; anything else is on the battery.
  $battery = Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($null -eq $battery) { return 'none' }
  return ([string]$battery.BatteryStatus + ':' + [string]$battery.EstimatedChargeRemaining)
}

function Get-CpuTemperature {
  # Tenths of a Kelvin, and absent on most desktops — an empty reply tells the
  # Node side to stop asking.
  $zone = Get-CimInstance MSAcpi_ThermalZoneTemperature -Namespace 'root/wmi' -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if ($null -eq $zone -or $null -eq $zone.CurrentTemperature) { return '' }
  return [string]([math]::Round(($zone.CurrentTemperature / 10) - 273.15, 1))
}

[Console]::Out.WriteLine('ready=1')
[Console]::Out.Flush()

# Labelled, because a bare break inside a switch leaves the switch and not the
# loop - without the label the 'quit' command below never ends the process.
:pump while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break pump }
  switch ($line.Trim()) {
    'fs'    { if ($FullscreenReady) { [Console]::Out.WriteLine('fs=' + [CodexProbe]::ForegroundIsFullscreen()) } else { [Console]::Out.WriteLine('fs=0') } }
    'fg'    { if ($ForegroundReady) { [Console]::Out.WriteLine('fg=' + [CodexProbe]::ForegroundInfo()) } else { [Console]::Out.WriteLine('fg=') } }
    'mic'   { [Console]::Out.WriteLine('mic=' + (Get-MicrophoneUsers)) }
    'procs' { [Console]::Out.WriteLine('procs=' + (Get-ProcessNames)) }
    'disk'  { [Console]::Out.WriteLine('disk=' + (Get-DriveSpace)) }
    'bat'   { [Console]::Out.WriteLine('bat=' + (Get-BatteryState)) }
    'temp'  { [Console]::Out.WriteLine('temp=' + (Get-CpuTemperature)) }
    'quit'  { break pump }
    default { }
  }
  [Console]::Out.Flush()
}
`;
