# Window-state control helper for the screenshot/window-state probe
# (test/screenshot-window-probe.ts). Windows-only.
#
# Drives a single top-level window via user32.dll: minimize, restore, or query
# its state (minimized / visible / foreground). The probe uses it to put the
# editor or game window into the states the screenshot tools must react to
# (minimized -> EDITOR_VIEWPORT_UNAVAILABLE / RUNTIME_WINDOW_MINIMIZED, etc.),
# then restore it afterward.
#
# It also resolves a process id from a LISTENING TCP port (the probe uses this to
# find the editor / game process from the port each already connects to, instead
# of depending on the toolkit's registry).
#
# Invocation (from Node via child_process): the script is passed as a base64
# UTF-16LE blob to
#   powershell -NoProfile -NonInteractive -EncodedCommand <b64>
# with inputs passed as environment variables. -EncodedCommand (not stdin
# `-Command -`) is required: the line-based stdin reader mis-parses the C#
# here-string this script uses for Add-Type, silently producing no output.
# -EncodedCommand needs no script-file ExecutionPolicy bypass and avoids
# argv-quoting hazards. Inputs:
#   WCTL_ACTION  = query | minimize | restore | foreground | unfocus | portowner
#   WCTL_PID     = (window actions) target process id (decimal). The FIRST visible
#                  top-level window owned by this pid is acted on.
#   WCTL_PORT    = (portowner only) TCP port whose LISTENING-socket owner pid to
#                  resolve.
#   WCTL_DESKTOP = (unfocus only) pid whose window should receive focus instead,
#                  used to steal foreground away from WCTL_PID. Optional.
#
# Output: a single JSON line on stdout, e.g.
#   {"ok":true,"action":"query","pid":1234,"found":true,"hwnd":66048,
#    "minimized":false,"visible":true,"foreground":true}
#   {"ok":true,"action":"portowner","port":6550,"found":true,"pid":19664}
# On any failure: {"ok":false,"error":"..."}.  Exit code is 0 on ok, 1 on error.

$ErrorActionPreference = "Stop"
# Silence the "Preparing modules for first use" progress record — it is emitted
# as CLIXML on stderr and only clutters diagnostics (stdout stays clean JSON).
$ProgressPreference = "SilentlyContinue"

$signature = @'
using System;
using System.Runtime.InteropServices;
using System.Collections.Generic;
public static class WinCtl {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

  // SW_MINIMIZE = 6, SW_RESTORE = 9. GW_OWNER = 4.
  public const int SW_MINIMIZE = 6;
  public const int SW_RESTORE = 9;
  public const uint GW_OWNER = 4;

  // FALLBACK window resolver: first VISIBLE top-level window owned by pid that
  // has a title (skips the invisible message-only / tool windows a process also
  // owns); falls back to any visible window if none has a title. Used only when
  // Process.MainWindowHandle is 0 — Godot's main window does NOT map back to the
  // socket-owning PID via GetWindowThreadProcessId (its window/thread ownership
  // differs), so MainWindowHandle is the primary resolver (see the caller).
  public static IntPtr MainWindowForPid(uint target) {
    IntPtr titled = IntPtr.Zero;
    IntPtr anyVisible = IntPtr.Zero;
    EnumWindows((h, l) => {
      uint p; GetWindowThreadProcessId(h, out p);
      if (p != target) return true;
      if (!IsWindowVisible(h)) return true;
      if (anyVisible == IntPtr.Zero) anyVisible = h;
      if (titled == IntPtr.Zero && GetWindowTextLength(h) > 0) titled = h;
      return true;
    }, IntPtr.Zero);
    return titled != IntPtr.Zero ? titled : anyVisible;
  }
}
'@
Add-Type -TypeDefinition $signature

function Emit([hashtable]$obj) {
  # Compress to a single line so Node can read exactly one JSON payload.
  Write-Output ($obj | ConvertTo-Json -Compress)
}

# Resolve a process's top-level window handle. Primary: Process.MainWindowHandle
# (finds Godot's main window, which an EnumWindows-by-PID scan misses because its
# window/thread ownership does not map back to the socket-owning PID). Fallback:
# the EnumWindows-by-PID scan for processes whose MainWindowHandle is 0. Returns
# [IntPtr]::Zero when neither finds a window.
function Resolve-Hwnd([int]$targetPid) {
  if ($targetPid -le 0) { return [IntPtr]::Zero }
  $proc = Get-Process -Id $targetPid -ErrorAction SilentlyContinue
  if ($null -ne $proc -and $proc.MainWindowHandle -ne [IntPtr]::Zero) {
    return $proc.MainWindowHandle
  }
  return [WinCtl]::MainWindowForPid([uint32]$targetPid)
}

try {
  $action = $env:WCTL_ACTION
  if ([string]::IsNullOrEmpty($action)) { throw "WCTL_ACTION not set" }

  # portowner: resolve the pid owning the LISTENING socket on a TCP port. Takes a
  # port, not a pid — handled up front, before the window-pid validation. Uses
  # Get-NetTCPConnection (no netstat text parsing); returns the first listener.
  if ($action -eq "portowner") {
    $portValue = 0
    [void][int]::TryParse($env:WCTL_PORT, [ref]$portValue)
    if ($portValue -le 0) { throw "WCTL_PORT missing or invalid: '$($env:WCTL_PORT)'" }
    $ownerPid = Get-NetTCPConnection -LocalPort $portValue -State Listen -ErrorAction SilentlyContinue |
      Select-Object -First 1 -ExpandProperty OwningProcess
    if ($null -eq $ownerPid) {
      Emit @{ ok = $true; action = "portowner"; port = $portValue; found = $false; pid = 0 }
    }
    else {
      Emit @{ ok = $true; action = "portowner"; port = $portValue; found = $true; pid = [int]$ownerPid }
    }
    exit 0
  }

  $pidValue = 0
  [void][int]::TryParse($env:WCTL_PID, [ref]$pidValue)
  if ($pidValue -le 0) { throw "WCTL_PID missing or invalid: '$($env:WCTL_PID)'" }

  $hwnd = Resolve-Hwnd $pidValue
  $found = ($hwnd -ne [IntPtr]::Zero)

  switch ($action) {
    "minimize" {
      if (-not $found) { throw "no visible top-level window for pid $pidValue" }
      [void][WinCtl]::ShowWindow($hwnd, [WinCtl]::SW_MINIMIZE)
    }
    "restore" {
      if (-not $found) { throw "no visible top-level window for pid $pidValue" }
      [void][WinCtl]::ShowWindow($hwnd, [WinCtl]::SW_RESTORE)
      [void][WinCtl]::SetForegroundWindow($hwnd)
    }
    "foreground" {
      if (-not $found) { throw "no visible top-level window for pid $pidValue" }
      [void][WinCtl]::SetForegroundWindow($hwnd)
    }
    "unfocus" {
      # Move focus AWAY from the target's window by foregrounding another pid's
      # window (the desktop pid), leaving the target visible but not focused.
      $otherPid = 0
      [void][int]::TryParse($env:WCTL_DESKTOP, [ref]$otherPid)
      if ($otherPid -gt 0) {
        $otherHwnd = Resolve-Hwnd $otherPid
        if ($otherHwnd -ne [IntPtr]::Zero) { [void][WinCtl]::SetForegroundWindow($otherHwnd) }
      }
    }
    "query" { }
    default { throw "unknown action: $action" }
  }

  # Re-read state after the action so the caller sees the result. `owner_hwnd`
  # is the ground-truth embedded-vs-floating signal on Windows: an editor-embedded
  # game is an owner-linked top-level popup (GW_OWNER -> the editor's window), a
  # floating game is a plain top-level (GW_OWNER -> 0). Deterministic, side-effect
  # free — no need to prod the game to learn which it is.
  $minimized = $false
  $visible = $false
  $ownerHwnd = [long]0
  if ($found) {
    $minimized = [WinCtl]::IsIconic($hwnd)
    $visible = [WinCtl]::IsWindowVisible($hwnd)
    $ownerHwnd = [WinCtl]::GetWindow($hwnd, [WinCtl]::GW_OWNER).ToInt64()
  }
  $fg = [WinCtl]::GetForegroundWindow()
  $isForeground = ($found -and ($fg -eq $hwnd))

  Emit @{
    ok = $true
    action = $action
    pid = $pidValue
    found = $found
    hwnd = $hwnd.ToInt64()
    owner_hwnd = $ownerHwnd
    minimized = [bool]$minimized
    visible = [bool]$visible
    foreground = [bool]$isForeground
  }
  exit 0
}
catch {
  Emit @{ ok = $false; error = $_.Exception.Message }
  exit 1
}
