# scripts/ci/process-snapshot.ps1
# The process snapshot run-bounded.sh prints before it ends a command that ran past its bound. It
# lists the native process tree under -Root, marked "tree", and every other process created since
# -Since (Unix seconds) whose parent has exited, marked "orphan": a tree kill cannot reach an
# orphan, so this list is the only place one that survives the kill is named. Without -Root the
# tree is empty and only the orphans are listed. One row per process: pid, parent pid, mark,
# creation time (UTC), image name, command line.
param(
  [uint32]$Root,
  [Parameter(Mandatory = $true)][long]$Since
)

# UTF-8 so a non-ASCII command line survives; a host that refuses keeps its default.
try { [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false) } catch { }

$all = @(Get-CimInstance -ClassName Win32_Process)
$byPid = @{}
foreach ($p in $all) { $byPid[[uint32]$p.ProcessId] = $p }

# A parent pid can name a newer process that reused the number, so a parent counts only when it
# was created before its child. A process that names itself, as pid 0 does, or a creation time
# Windows does not report, would let a walk up the parents go on forever, so neither counts.
function Get-LiveParent($p) {
  if ($p.ParentProcessId -eq $p.ProcessId -or $null -eq $p.CreationDate) { return $null }
  $parent = $byPid[[uint32]$p.ParentProcessId]
  if ($null -ne $parent -and $null -ne $parent.CreationDate -and $parent.CreationDate -le $p.CreationDate) {
    return $parent
  }
  return $null
}

$hasRoot = $PSBoundParameters.ContainsKey('Root')
$tree = @{}
if ($hasRoot -and $byPid.ContainsKey($Root)) { $tree[$Root] = $true }
do {
  $grew = $false
  foreach ($p in $all) {
    $id = [uint32]$p.ProcessId
    if ($tree.ContainsKey($id)) { continue }
    $parent = Get-LiveParent $p
    if ($null -ne $parent -and $tree.ContainsKey([uint32]$parent.ProcessId)) {
      $tree[$id] = $true
      $grew = $true
    }
  }
} while ($grew)

# The callers above -Root and the snapshot's own chain are no orphans of the command, even when an
# MSYS process between them has already exited.
$own = @{ [uint32]$PID = $true }
$starts = @($byPid[[uint32]$PID])
if ($hasRoot) { $starts += $byPid[$Root] }
foreach ($start in $starts) {
  $p = $start
  while ($null -ne $p) {
    $own[[uint32]$p.ProcessId] = $true
    $p = Get-LiveParent $p
  }
}

$cutoff = [DateTimeOffset]::FromUnixTimeSeconds($Since - 1).UtcDateTime
$rows = foreach ($p in $all) {
  $id = [uint32]$p.ProcessId
  if ($tree.ContainsKey($id)) {
    $mark = 'tree'
  } elseif ($own.ContainsKey($id)) {
    continue
  } elseif ($null -ne $p.CreationDate -and $p.CreationDate.ToUniversalTime() -ge $cutoff -and
    $null -eq (Get-LiveParent $p)) {
    $mark = 'orphan'
  } else {
    continue
  }
  [pscustomobject]@{ Process = $p; Mark = $mark }
}

Write-Output ('{0,7} {1,7} {2,-6} {3,-12} {4,-28} {5}' -f 'pid', 'parent', 'mark', 'created', 'name', 'command line')
foreach ($r in @($rows | Sort-Object { $_.Process.CreationDate })) {
  $p = $r.Process
  $created = if ($null -ne $p.CreationDate) { $p.CreationDate.ToUniversalTime().ToString('HH:mm:ss.fff') } else { '?' }
  Write-Output ('{0,7} {1,7} {2,-6} {3,-12} {4,-28} {5}' -f $p.ProcessId, $p.ParentProcessId, $r.Mark,
    $created, $p.Name, $p.CommandLine)
}
if (@($rows).Count -eq 0) { Write-Output 'no process in the tree and no orphan since the start' }
