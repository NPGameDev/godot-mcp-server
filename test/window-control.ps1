# Window-state control helper for the screenshot/window-state probe
# (test/screenshot-window-probe.ts). Windows-only.
#
# Drives a single top-level window via user32.dll: minimize, restore, or query
# its state (minimized / visible / foreground). The probe uses it to put the
# editor or game window into the states the screenshot tools must react to
# (minimized -> EDITOR_VIEWPORT_UNAVAILABLE / RUNTIME_WINDOW_MINIMIZED, etc.),
# then restore it afterward.
#
# Invocation (from Node via child_process): the script body is piped to
#   powershell -NoProfile -NonInteractive -Command -
# with inputs passed as environment variables (avoids a script-file
# ExecutionPolicy gate and any argv-quoting hazard):
#   WCTL_ACTION  = query | minimize | restore | foreground | unfocus
#   WCTL_PID     = target process id (decimal). The FIRST visible top-level
#                  window owned by this pid is acted on.
#   WCTL_DESKTOP = (unfocus only) pid whose window should receive focus instead,
#                  used to steal foreground away from WCTL_PID. Optional.
#
# Output: a single JSON line on stdout, e.g.
#   {"ok":true,"action":"query","pid":1234,"found":true,"hwnd":66048,
#    "minimized":false,"visible":true,"foreground":true}
# On any failure: {"ok":false,"error":"..."}.  Exit code is 0 on ok, 1 on error.

$ErrorActionPreference = "Stop"

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

  // First VISIBLE top-level window owned by pid that has a title (skips the
  // invisible message-only / tool windows a process also owns). Falls back to
  // any visible window if none has a title.
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

try {
  $action = $env:WCTL_ACTION
  $pidValue = 0
  [void][int]::TryParse($env:WCTL_PID, [ref]$pidValue)
  if ([string]::IsNullOrEmpty($action)) { throw "WCTL_ACTION not set" }
  if ($pidValue -le 0) { throw "WCTL_PID missing or invalid: '$($env:WCTL_PID)'" }

  $hwnd = [WinCtl]::MainWindowForPid([uint32]$pidValue)
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
        $otherHwnd = [WinCtl]::MainWindowForPid([uint32]$otherPid)
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
